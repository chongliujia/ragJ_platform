import React, { useEffect, useRef, useState } from 'react';
import { Paper, IconButton, TextField, Tooltip, Box, Typography } from '@mui/material';
import ChatIcon from '@mui/icons-material/Chat';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PushPinIcon from '@mui/icons-material/PushPin';
import ReactMarkdown from 'react-markdown';
import { workflowApi } from '../services/api';

interface ChatTesterWidgetProps {
  workflowId?: string; // 若提供，则基于该工作流进行对话测试；否则从 localStorage.current_workflow_id 读取
  onEnsureSaved?: () => Promise<string | undefined>; // 由编辑器传入：发送前确保保存并返回后端ID
  onProgress?: (evt: any) => void; // 将执行进度透传给编辑器进行动态运作展示
  onComplete?: (evt: any) => void;
  onError?: (err: any) => void;
}

const ChatTesterWidget: React.FC<ChatTesterWidgetProps> = ({ workflowId, onEnsureSaved, onProgress, onComplete, onError }) => {
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [text, setText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [currentStreamMessage, setCurrentStreamMessage] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string; streaming?: boolean }[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | undefined>(workflowId);
  const requireWorkflow = true;
  const noWorkflow = requireWorkflow && !currentWorkflowId;
  const [dock, setDock] = useState<'br' | 'bl' | 'tr' | 'tl'>(() => {
    if (typeof window === 'undefined') return 'br';
    return (localStorage.getItem('chat_widget_dock') as any) || 'br';
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const [customPos, setCustomPos] = useState<{ left: number; top: number } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('chat_widget_pos');
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  });
  const dragState = useRef<{ offsetX: number; offsetY: number; dragging: boolean }>({ offsetX: 0, offsetY: 0, dragging: false });

  // 初始化读取/监听当前工作流ID（来自 localStorage）
  useEffect(() => {
    if (!workflowId) {
      const id = typeof window !== 'undefined' ? localStorage.getItem('current_workflow_id') || undefined : undefined;
      setCurrentWorkflowId(id as string | undefined);
      const onStorage = (e: StorageEvent) => {
        if (e.key === 'current_workflow_id') {
          setCurrentWorkflowId(e.newValue || undefined);
        }
        if (e.key === 'chat_widget_dock' && e.newValue) {
          setDock(e.newValue as any);
        }
        if (e.key === 'chat_widget_pos' && e.newValue) {
          try { setCustomPos(JSON.parse(e.newValue)); } catch {}
        }
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    } else {
      setCurrentWorkflowId(workflowId);
    }
  }, [workflowId]);

  // 持久化自定义位置
  useEffect(() => {
    if (customPos) {
      try { localStorage.setItem('chat_widget_pos', JSON.stringify(customPos)); } catch {}
    }
  }, [customPos]);

  const startDrag = (clientX: number, clientY: number) => {
    const rect = panelRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    dragState.current = { offsetX: clientX - left, offsetY: clientY - top, dragging: true };
  };

  const onMouseDownHeader = (e: React.MouseEvent) => {
    // 避免在点击图标按钮时触发拖拽
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    startDrag(e.clientX, e.clientY);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const onTouchStartHeader = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);
    window.addEventListener('touchmove', onTouchMove);
    window.addEventListener('touchend', onTouchEnd);
  };

  const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

  const applyMove = (clientX: number, clientY: number) => {
    if (!dragState.current.dragging) return;
    const w = panelRef.current?.offsetWidth ?? 360;
    const h = panelRef.current?.offsetHeight ?? 420;
    const left = clamp(clientX - dragState.current.offsetX, 8, window.innerWidth - w - 8);
    const top = clamp(clientY - dragState.current.offsetY, 8, window.innerHeight - h - 8);
    setCustomPos({ left, top });
  };

  const onMouseMove = (e: MouseEvent) => { applyMove(e.clientX, e.clientY); };
  const onMouseUp = () => {
    dragState.current.dragging = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
  const onTouchMove = (e: TouchEvent) => { const t = e.touches[0]; applyMove(t.clientX, t.clientY); };
  const onTouchEnd = () => {
    dragState.current.dragging = false;
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
  };

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const content = text.trim();
    if (!content) return;
    
    console.log('Chat testing - starting send, currentWorkflowId:', currentWorkflowId);
    
    // 发送前如果没有绑定到后端工作流，尝试让编辑器先保存
    if (!currentWorkflowId && onEnsureSaved) {
      console.log('Chat testing - no workflow ID, trying to save...');
      try {
        const id = await onEnsureSaved();
        console.log('Chat testing - save result:', id);
        if (id) {
          setCurrentWorkflowId(id);
          try { localStorage.setItem('current_workflow_id', id); } catch {}
        }
      } catch (e) {
        console.error('Chat testing - save error:', e);
      }
    }
    if (requireWorkflow && !currentWorkflowId) {
      console.log('Chat testing - still no workflow ID after save attempt');
      setMessages(prev => [...prev, { role: 'assistant', content: '请先保存或选择一个工作流后再进行对话测试。' }]);
      return;
    }
    setText('');
    setMessages(prev => [...prev, { role: 'user', content }]);
    setStreaming(true);
    setThinking(true);
    setCurrentStreamMessage('');
    
    // 添加一个正在思考的助手消息
    setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);
    
    console.log('Chat testing - calling executeStream with ID:', currentWorkflowId);
    
    // 检查认证token
    const token = localStorage.getItem('auth_token');
    console.log('Chat testing - auth token exists:', !!token);
    console.log('Chat testing - auth token preview:', token ? token.substring(0, 20) + '...' : 'null');

    let buffer = '';
    try {
      if (currentWorkflowId) {
        // 基于工作流的执行流式
        await workflowApi.executeStream(
          currentWorkflowId,
          { input_data: { prompt: content, text: content, input: content, query: content } },
          // 第3个参数: onProgress
          (progressEvt) => {
            console.log('Chat testing - progress event:', progressEvt);
            onProgress?.(progressEvt);
          },
          // 第4个参数: onError 
          (err) => { 
            console.error('Chat testing - stream error:', err);
            setStreaming(false); // 重置streaming状态
            setThinking(false);
            setMessages(prev => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.role === 'assistant' && lastMessage.streaming) {
                lastMessage.content = `请求错误: ${err?.message || err}`;
                lastMessage.streaming = false;
              } else {
                newMessages.push({ role: 'assistant', content: `请求错误: ${err?.message || err}` });
              }
              return newMessages;
            });
            onError?.(err);
          },
          // 第5个参数: onComplete
          (completeEvt) => {
            console.log('Chat testing - onComplete callback triggered with:', completeEvt);
            if (!completeEvt) {
              console.log('Chat testing - onComplete called with null, stream ended');
              setStreaming(false); // 重置streaming状态
              setThinking(false);
              setMessages(prev => {
                const newMessages = [...prev];
                const lastMessage = newMessages[newMessages.length - 1];
                
                // 只更新正在 streaming 的 assistant 消息
                if (lastMessage && lastMessage.role === 'assistant' && lastMessage.streaming) {
                  lastMessage.content = lastMessage.content || '✓ 工作流执行完成';
                  lastMessage.streaming = false;
                  console.log('Chat testing - updated streaming message on null complete');
                }
                return newMessages;
              });
              return;
            }
            
            console.log('Chat testing - processing onComplete event:', completeEvt);
            setStreaming(false); // 重置streaming状态
            setThinking(false);
            const out = completeEvt?.result?.output_data || completeEvt?.data?.output_data || completeEvt?.output_data || {};
            console.log('Chat testing - complete output data:', out);
            
            // 取常见输出键，优先处理LLM节点的输出
            let text = '';
            if (typeof out.content === 'string') {
              text = out.content;
            } else if (typeof out.result === 'string') {
              text = out.result;
            } else if (typeof out.response === 'string') {
              text = out.response;
            } else if (typeof out.output === 'string') {
              text = out.output;
            } else {
              text = JSON.stringify(out, null, 2);
            }
            
            console.log('Chat testing - complete final text:', text);
            
            // 更新最后一条流式消息为完整内容
            setMessages(prev => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              
              // 确保只更新最后一条 assistant 类型的 streaming 消息
              if (lastMessage && lastMessage.role === 'assistant' && lastMessage.streaming) {
                lastMessage.content = text || '✓ 工作流执行完成';
                lastMessage.streaming = false;
                console.log('Chat testing - updated existing streaming message');
              } else {
                // 如果没有找到流式消息，检查是否已经有相同内容的消息
                const hasExistingMessage = newMessages.some(msg => 
                  msg.role === 'assistant' && msg.content === (text || '✓ 工作流执行完成')
                );
                
                if (!hasExistingMessage) {
                  newMessages.push({ role: 'assistant', content: text || '✓ 工作流执行完成' });
                  console.log('Chat testing - added new assistant message');
                } else {
                  console.log('Chat testing - message already exists, skipping duplicate');
                }
              }
              return newMessages;
            });
            onComplete?.(completeEvt);
          }
        );
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `请求失败: ${e?.message || e}` }]);
      setStreaming(false);
    }
  };

  const positionStyle: React.CSSProperties = (() => {
    const pad = 24;
    const safeBottom = 96; // 避开右下角 FAB（24 margin + 56按钮 + 16间距）
    if (customPos) {
      return { position: 'fixed', left: customPos.left, top: customPos.top, zIndex: 1400 };
    }
    switch (dock) {
      case 'bl': return { position: 'fixed', left: pad, bottom: safeBottom, zIndex: 1400 };
      case 'tr': return { position: 'fixed', right: pad, top: pad, zIndex: 1400 };
      case 'tl': return { position: 'fixed', left: pad, top: pad, zIndex: 1400 };
      case 'br':
      default: return { position: 'fixed', right: pad, bottom: safeBottom, zIndex: 1400 };
    }
  })();

  if (!open) {
    return (
      <IconButton
        onClick={() => setOpen(true)}
        sx={{
          ...(dock === 'bl' ? { left: 24, bottom: 24 } : {}),
          ...(dock === 'br' ? { right: 24, bottom: 24 } : {}),
          ...(dock === 'tr' ? { right: 24, top: 24 } : {}),
          ...(dock === 'tl' ? { left: 24, top: 24 } : {}),
          position: 'fixed', zIndex: 1400,
          bgcolor: '#0ea5e9', color: '#fff', '&:hover': { bgcolor: '#0284c7' }
        }}
      >
        <ChatIcon />
      </IconButton>
    );
  }

  return (
    <Paper ref={panelRef} elevation={8} sx={{
      ...positionStyle,
      width: 360, // 优化后的宽度
      height: collapsed ? 48 : 480, // 动态高度，折叠时更紧凑
      display: 'flex', 
      flexDirection: 'column',
      borderRadius: collapsed ? 24 : 3, // 折叠时更圆润
      overflow: 'hidden',
      border: '1px solid rgba(0, 212, 255, 0.3)',
      background: 'linear-gradient(180deg, #1a1f2e 0%, #0f1419 100%)',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', // 平滑过渡
    }}>
      <Box 
        sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          px: 2, 
          py: collapsed ? 0.75 : 1, // 折叠时减少垂直间距
          background: 'linear-gradient(135deg, #0f172a 0%, #1a1f2e 100%)',
          color: '#fff', 
          cursor: 'move',
          borderBottom: collapsed ? 'none' : '1px solid rgba(0, 212, 255, 0.2)',
          transition: 'all 0.3s ease',
        }}
        onMouseDown={onMouseDownHeader}
        onTouchStart={onTouchStartHeader}
      >
        <ChatIcon fontSize={collapsed ? "small" : "medium"} sx={{ 
          mr: collapsed ? 1 : 1.5, 
          color: '#00d4ff',
          transition: 'all 0.3s ease' 
        }} />
        <Box sx={{ 
          flex: 1,
          overflow: 'hidden', // 防止折叠时文字溢出
        }}>
          <Typography variant="subtitle1" sx={{ 
            fontWeight: 600, 
            fontSize: collapsed ? '0.8rem' : '0.9rem',
            transition: 'all 0.3s ease',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            智能工作流测试
          </Typography>
          {!collapsed && (
            <Typography variant="caption" sx={{ 
              color: 'rgba(255,255,255,0.7)', 
              fontSize: '0.7rem',
              display: 'block',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {currentWorkflowId ? `工作流: ${currentWorkflowId.slice(0,8)}...` : '请先保存工作流'}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: collapsed ? 0.25 : 0.5 }}>
          <Tooltip title="切换停靠位置">
            <IconButton size="small" onClick={() => {
              const order: Array<'br'|'bl'|'tr'|'tl'> = ['br','bl','tr','tl'];
              const next = order[(order.indexOf(dock) + 1) % order.length];
              setDock(next);
              try { localStorage.setItem('chat_widget_dock', next); } catch {}
              // 取消自定义位置，改为按角停靠
              setCustomPos(null);
              try { localStorage.removeItem('chat_widget_pos'); } catch {}
            }} sx={{ 
              color: '#fff', 
              p: collapsed ? 0.25 : 0.5,
              transition: 'all 0.3s ease'
            }}>
              <PushPinIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={collapsed ? '展开' : '折叠'}>
            <IconButton size="small" onClick={() => setCollapsed(!collapsed)} sx={{ 
              color: '#fff',
              p: collapsed ? 0.25 : 0.5,
              transition: 'all 0.3s ease'
            }}>
              {collapsed ? <ExpandMoreIcon /> : <ExpandLessIcon />}
            </IconButton>
          </Tooltip>
          <Tooltip title="关闭">
            <IconButton size="small" onClick={() => setOpen(false)} sx={{ 
              color: '#fff',
              p: collapsed ? 0.25 : 0.5,
              transition: 'all 0.3s ease'
            }}>
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {!collapsed && (
        <>
          {/* 全局挂载版本不再需要选择知识库，工作流内部配置决定是否启用RAG */}

          <Box ref={chatRef} sx={{ 
            flex: 1, 
            overflow: 'auto', 
            px: 2, 
            py: 2, 
            background: 'linear-gradient(180deg, #0b1220 0%, #0a0f1b 100%)',
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
          }}>
            {messages.map((m, i) => (
              <Box key={i} sx={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                mb: 1.5
              }}>
                <Box sx={{
                  maxWidth: '90%', // 增加最大宽度
                  minWidth: '200px', // 设置最小宽度
                  px: 2.5, 
                  py: 2, 
                  borderRadius: 3,
                  bgcolor: m.role === 'user' 
                    ? 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)' 
                    : 'rgba(45, 55, 72, 0.9)',
                  color: m.role === 'user' ? '#fff' : '#e5e7eb',
                  backdropFilter: 'blur(10px)',
                  border: m.role === 'user' 
                    ? '1px solid rgba(0, 212, 255, 0.3)' 
                    : '1px solid rgba(255, 255, 255, 0.1)',
                  boxShadow: m.role === 'user' 
                    ? '0 4px 16px rgba(0, 212, 255, 0.25)' 
                    : '0 4px 16px rgba(0, 0, 0, 0.4)',
                  position: 'relative',
                  wordWrap: 'break-word',
                  overflowWrap: 'break-word',
                  '&::before': m.role === 'assistant' ? {
                    content: '""',
                    position: 'absolute',
                    left: -8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 0,
                    height: 0,
                    borderTop: '8px solid transparent',
                    borderBottom: '8px solid transparent',
                    borderRight: '8px solid rgba(45, 55, 72, 0.9)',
                  } : {},
                  '&::after': m.role === 'user' ? {
                    content: '""',
                    position: 'absolute',
                    right: -8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 0,
                    height: 0,
                    borderTop: '8px solid transparent',
                    borderBottom: '8px solid transparent',
                    borderLeft: '8px solid #00d4ff',
                  } : {},
                }}>
                  {m.role === 'assistant' && m.streaming && !m.content ? (
                    // 思考指示器
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ 
                        display: 'flex', 
                        gap: 0.5,
                        '& > div': {
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          bgcolor: '#00d4ff',
                          animation: 'pulse 1.5s ease-in-out infinite',
                          '&:nth-child(2)': { animationDelay: '0.2s' },
                          '&:nth-child(3)': { animationDelay: '0.4s' },
                        },
                        '@keyframes pulse': {
                          '0%, 60%, 100%': { opacity: 0.3, transform: 'scale(0.8)' },
                          '30%': { opacity: 1, transform: 'scale(1.2)' },
                        }
                      }}>
                        <div />
                        <div />
                        <div />
                      </Box>
                      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem' }}>
                        AI正在思考...
                      </Typography>
                    </Box>
                  ) : (
                    <Box sx={{ 
                      fontSize: '0.875rem',
                      lineHeight: 1.6,
                      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                      '& h1': {
                        fontSize: '1.1rem',
                        fontWeight: 700,
                        margin: '0.5em 0 0.3em 0',
                        color: m.role === 'user' ? '#fff' : '#00d4ff',
                      },
                      '& h2': {
                        fontSize: '1rem',
                        fontWeight: 600,
                        margin: '0.5em 0 0.3em 0',
                        color: m.role === 'user' ? '#fff' : '#00d4ff',
                      },
                      '& h3': {
                        fontSize: '0.95rem',
                        fontWeight: 600,
                        margin: '0.4em 0 0.2em 0',
                        color: m.role === 'user' ? '#fff' : '#00d4ff',
                      },
                      '& p': {
                        margin: '0.3em 0',
                        wordBreak: 'break-word',
                      },
                      '& ul, & ol': {
                        margin: '0.5em 0',
                        paddingLeft: '1.5em',
                      },
                      '& li': {
                        margin: '0.2em 0',
                        wordBreak: 'break-word',
                      },
                      '& strong': {
                        fontWeight: 600,
                        color: m.role === 'user' ? '#fff' : '#fff',
                      },
                      '& em': {
                        fontStyle: 'italic',
                        color: m.role === 'user' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.8)',
                      },
                      '& code': {
                        backgroundColor: 'rgba(255, 255, 255, 0.15)',
                        padding: '0.15em 0.4em',
                        borderRadius: '3px',
                        fontSize: '0.85em',
                        fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                        color: m.role === 'user' ? '#fff' : '#e0e0e0',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                      },
                      '& pre': {
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        padding: '0.75em',
                        borderRadius: '6px',
                        overflow: 'auto',
                        fontSize: '0.8em',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        margin: '0.5em 0',
                      },
                      '& pre code': {
                        backgroundColor: 'transparent',
                        padding: 0,
                        border: 'none',
                      },
                      '& blockquote': {
                        borderLeft: '3px solid rgba(0, 212, 255, 0.5)',
                        paddingLeft: '1em',
                        margin: '0.5em 0',
                        fontStyle: 'italic',
                        backgroundColor: 'rgba(0, 0, 0, 0.1)',
                        padding: '0.5em 0.5em 0.5em 1em',
                        borderRadius: '0 4px 4px 0',
                      }
                    }}>
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                      {m.streaming && m.content && (
                        <Box component="span" sx={{ 
                          display: 'inline-block',
                          width: 3,
                          height: 18,
                          bgcolor: '#00d4ff',
                          ml: 0.5,
                          animation: 'blink 1s infinite',
                          '@keyframes blink': {
                            '0%, 50%': { opacity: 1 },
                            '51%, 100%': { opacity: 0 },
                          }
                        }} />
                      )}
                    </Box>
                  )}
                </Box>
              </Box>
            ))}
            {noWorkflow && (
              <Box sx={{ 
                p: 3, 
                textAlign: 'center', 
                border: '1px dashed rgba(255, 152, 0, 0.3)',
                borderRadius: 2,
                background: 'rgba(255, 152, 0, 0.05)'
              }}>
                <Typography variant="body2" sx={{ color: 'rgba(255, 152, 0, 0.9)', fontSize: '0.9rem', mb: 1 }}>
                  ⚠️ 工作流未就绪
                </Typography>
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.8rem' }}>
                  请先保存工作流，然后即可开始智能对话测试
                </Typography>
              </Box>
            )}
          </Box>

          <Box sx={{ 
            p: 2, 
            display: 'flex', 
            gap: 1, 
            borderTop: '1px solid rgba(0, 212, 255, 0.2)',
            background: 'linear-gradient(135deg, #0f172a 0%, #1a1f2e 100%)'
          }}>
            <TextField
              size="small"
              fullWidth
              placeholder="输入消息开始对话..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              disabled={streaming || noWorkflow}
              multiline
              maxRows={3}
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: 'rgba(45, 55, 72, 0.6)',
                  borderRadius: '20px',
                  fontSize: '0.9rem',
                  '& fieldset': {
                    borderColor: 'rgba(0, 212, 255, 0.3)',
                  },
                  '&:hover fieldset': {
                    borderColor: 'rgba(0, 212, 255, 0.5)',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#00d4ff',
                    borderWidth: '2px',
                  },
                },
                '& .MuiInputBase-input': {
                  color: 'white',
                  padding: '12px 16px',
                  '&::placeholder': {
                    color: 'rgba(255, 255, 255, 0.5)',
                  },
                },
              }}
            />
            <IconButton 
              color="primary" 
              onClick={send} 
              disabled={streaming || noWorkflow || !text.trim()}
              sx={{
                bgcolor: text.trim() && !streaming && !noWorkflow ? '#00d4ff' : 'rgba(45, 55, 72, 0.6)',
                color: text.trim() && !streaming && !noWorkflow ? '#fff' : 'rgba(255, 255, 255, 0.4)',
                width: 44,
                height: 44,
                '&:hover': {
                  bgcolor: text.trim() && !streaming && !noWorkflow ? '#0099cc' : 'rgba(45, 55, 72, 0.8)',
                },
                '&:disabled': {
                  bgcolor: 'rgba(45, 55, 72, 0.3)',
                  color: 'rgba(255, 255, 255, 0.2)',
                }
              }}
            >
              <SendIcon />
            </IconButton>
          </Box>
        </>
      )}
    </Paper>
  );
};

export default ChatTesterWidget;
