import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  Typography,
  Box,
  Paper,
  TextField,
  Button,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  CircularProgress,
  Alert,
  Chip,
  IconButton,
  Stack,
} from '@mui/material';
import {
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
  Stop as StopIcon,
  Replay as ReplayIcon,
  ContentCopy as CopyIcon,
} from '@mui/icons-material';
import { knowledgeBaseApi, chatApi } from '../services/api';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'bot';
  timestamp: Date;
  sources?: string[];
}

interface KnowledgeBase {
  id: string;
  name: string;
}

const Chat: React.FC = () => {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [selectedKb, setSelectedKb] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<null | (() => void)>(null);
  const lastUserMessageRef = useRef<string>('');

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 获取知识库列表
  const fetchKnowledgeBases = async () => {
    try {
      const response = await knowledgeBaseApi.getList();
      setKnowledgeBases(response.data);
    } catch (error) {
      console.error('Failed to fetch knowledge bases:', error);
      setError(t('chat.fetchKnowledgeBasesError'));
    }
  };

  useEffect(() => {
    fetchKnowledgeBases();
    
    // 添加欢迎消息
    setMessages([
      {
        id: '1',
        content: t('chat.welcome'),
        sender: 'bot',
        timestamp: new Date(),
      },
    ]);
  }, [t]);

  // 发送消息
  const sendMessage = async () => {
    if (!inputMessage.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputMessage,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const currentMessage = inputMessage;
    lastUserMessageRef.current = currentMessage;
    setInputMessage('');
    setLoading(true);
    setError(null);

    // 创建一个空的机器人消息用于流式更新
    const botMessageId = (Date.now() + 1).toString();
    const botMessage: Message = {
      id: botMessageId,
      content: '',
      sender: 'bot',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, botMessage]);

    try {
      const requestData: any = {
        message: currentMessage,
      };
      
      // 只有选择了知识库才传递knowledge_base_id
      if (selectedKb) {
        requestData.knowledge_base_id = selectedKb;
      }

      const { cancel, promise } = chatApi.streamMessageCancelable(
        requestData,
        (chunk) => {
          if (chunk?.success && chunk?.content) {
            setMessages(prev => prev.map(m => m.id === botMessageId ? { ...m, content: m.content + chunk.content } : m));
          } else if (chunk?.type === 'sources' && Array.isArray(chunk.sources)) {
            setMessages(prev => prev.map(m => m.id === botMessageId ? { ...m, sources: chunk.sources } : m));
          } else if (chunk?.success === false) {
            const errorContent = chunk.error || t('chat.errorResponse');
            setMessages(prev => prev.map(m => m.id === botMessageId ? { ...m, content: errorContent } : m));
          }
        },
        (err) => {
          console.error('Stream error:', err);
          const isTimeout = err?.message?.includes('timeout');
          const errorContent = isTimeout
            ? (selectedKb ? '处理知识库查询时超时，请稍后重试。如果问题持续存在，请尝试简化您的问题。' : '请求超时，请稍后重试。')
            : t('chat.errorResponse');
          setMessages(prev => prev.map(m => m.id === botMessageId ? { ...m, content: errorContent } : m));
          setLoading(false);
        },
        () => setLoading(false)
      );
      cancelRef.current = cancel;
      await promise;
      cancelRef.current = null;
    } catch (error: any) {
      console.error('Failed to send message:', error);
      
      // 根据错误类型提供更友好的错误消息
      let errorContent = t('chat.errorResponse');
      if (error.code === 'ECONNABORTED') {
        errorContent = selectedKb 
          ? '处理知识库查询时超时，请稍后重试。如果问题持续存在，请尝试简化您的问题。'
          : '请求超时，请稍后重试。';
      }
      
      setMessages(prev => 
        prev.map(msg => 
          msg.id === botMessageId 
            ? { ...msg, content: errorContent }
            : msg
        )
      );
      setLoading(false);
    }
  };

  // 停止生成
  const stopGenerating = () => {
    const cancel = cancelRef.current;
    if (cancel) {
      try { cancel(); } catch {}
      cancelRef.current = null;
      setLoading(false);
    }
  };

  // 重新生成
  const regenerate = () => {
    const last = lastUserMessageRef.current;
    if (last) {
      setInputMessage(last);
      setTimeout(() => sendMessage(), 0);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <Box sx={{ 
      height: 'calc(100vh - 100px)', 
      display: 'flex', 
      flexDirection: 'column',
      maxWidth: '1200px',
      margin: '0 auto',
      p: { xs: 1, sm: 2 }
    }}>
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        mb: 3,
        flexWrap: 'wrap',
        gap: 2
      }}>
        <Typography variant="h4" sx={{ 
          fontWeight: 'bold',
          background: 'linear-gradient(45deg, #00d4ff, #0099cc)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          fontFamily: 'Inter, sans-serif'
        }}>
          {t('chat.title')}
        </Typography>
        
        <FormControl sx={{ 
          minWidth: 200,
          '& .MuiSelect-select': {
            fontFamily: 'Inter, sans-serif',
            fontWeight: 500
          }
        }}>
          <InputLabel>{t('chat.selectKnowledgeBase')}</InputLabel>
          <Select
            value={selectedKb}
            label={t('chat.selectKnowledgeBase')}
            onChange={(e) => setSelectedKb(e.target.value)}
          >
            <MenuItem value="">
              <em>{t('chat.normalChat')}</em>
            </MenuItem>
            {knowledgeBases.map((kb) => (
              <MenuItem key={kb.id} value={kb.id}>
                {kb.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* 消息列表 */}
      <Paper sx={{ 
        flex: 1, 
        overflow: 'auto', 
        mb: 2,
        background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.9) 0%, rgba(26, 31, 46, 0.7) 100%)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(0, 212, 255, 0.2)',
        borderRadius: 3,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
      }}>
        <List sx={{ p: 2 }}>
          {messages.map((message) => (
            <ListItem key={message.id} sx={{ 
              alignItems: 'flex-start',
              mb: 2,
              flexDirection: message.sender === 'user' ? 'row-reverse' : 'row'
            }}>
              <ListItemAvatar sx={{ 
                ml: message.sender === 'user' ? 1 : 0,
                mr: message.sender === 'user' ? 0 : 1
              }}>
                <Avatar sx={{ 
                  bgcolor: message.sender === 'user' ? 'primary.main' : 'secondary.main',
                  width: 40,
                  height: 40,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
                }}>
                  {message.sender === 'user' ? <PersonIcon /> : <BotIcon />}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                sx={{ margin: 0 }}
                primary={
                  <Box sx={{ 
                    background: message.sender === 'user' 
                      ? 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)'
                      : 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)',
                    p: 2.5,
                    borderRadius: 2,
                    maxWidth: '85%',
                    ml: message.sender === 'user' ? 'auto' : 0,
                    mr: message.sender === 'user' ? 0 : 'auto',
                    border: message.sender === 'user' 
                      ? '1px solid rgba(255, 255, 255, 0.1)'
                      : '1px solid rgba(0, 212, 255, 0.2)',
                    boxShadow: message.sender === 'user'
                      ? '0 4px 16px rgba(0, 212, 255, 0.2)'
                      : '0 4px 16px rgba(0, 0, 0, 0.3)',
                    position: 'relative',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      top: 15,
                      left: message.sender === 'user' ? 'auto' : -8,
                      right: message.sender === 'user' ? -8 : 'auto',
                      width: 0,
                      height: 0,
                      borderStyle: 'solid',
                      borderWidth: message.sender === 'user' 
                        ? '8px 0 8px 8px'
                        : '8px 8px 8px 0',
                      borderColor: message.sender === 'user'
                        ? 'transparent transparent transparent #00d4ff'
                        : 'transparent #2a2a2a transparent transparent'
                    }
                  }}>
                    {message.sender === 'bot' ? (
                      <Box sx={{ 
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '0.875rem',
                        lineHeight: 1.6,
                        color: 'text.primary',
                        fontWeight: 400,
                        '& p': { margin: '0.5em 0' },
                        '& h1': { 
                          margin: '1em 0 0.5em 0',
                          fontWeight: 600,
                          fontSize: '1.1rem'
                        },
                        '& h2': { 
                          margin: '0.8em 0 0.4em 0',
                          fontWeight: 600,
                          fontSize: '1.05rem'
                        },
                        '& h3': { 
                          margin: '0.6em 0 0.3em 0',
                          fontWeight: 600,
                          fontSize: '1rem'
                        },
                        '& ul, & ol': { 
                          margin: '0.5em 0',
                          paddingLeft: '1.5em'
                        },
                        '& li': { margin: '0.25em 0' },
                        '& strong': { fontWeight: 600 },
                        '& code': { 
                          backgroundColor: 'rgba(0, 0, 0, 0.1)',
                          padding: '0.2em 0.4em',
                          borderRadius: '3px',
                          fontFamily: 'monospace',
                          fontSize: '0.9em'
                        },
                        '& pre': {
                          backgroundColor: 'rgba(0, 0, 0, 0.05)',
                          padding: '1em',
                          borderRadius: '5px',
                          overflow: 'auto',
                          fontFamily: 'monospace',
                          fontSize: '0.9em'
                        }
                      }}>
                        <ReactMarkdown
                          components={{
                            code({node, inline, className, children, ...props}) {
                              const match = /language-(\w+)/.exec(className || '');
                              const codeString = String(children || '').replace(/\n$/, '');
                              const lang = match ? match[1] : 'plaintext';
                              const onCopy = () => navigator.clipboard.writeText(codeString).catch(()=>{});
                              if (inline) {
                                return <code className={className} {...props}>{children}</code>;
                              }
                              return (
                                <Box sx={{ position: 'relative' }}>
                                  <IconButton size="small" onClick={onCopy} sx={{ position: 'absolute', right: 6, top: 6, zIndex: 1 }}>
                                    <CopyIcon fontSize="small" />
                                  </IconButton>
                                  <SyntaxHighlighter language={lang} style={oneDark} PreTag="div" customStyle={{ borderRadius: 8, paddingTop: 28 }}>
                                    {codeString}
                                  </SyntaxHighlighter>
                                </Box>
                              );
                            }
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                        {message.sources && message.sources.length > 0 && (
                          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                            {message.sources.map((s, idx) => (
                              <Chip key={idx} label={s} size="small" variant="outlined" color="info" />
                            ))}
                          </Stack>
                        )}
                      </Box>
                    ) : (
                      <Typography variant="body1" sx={{ 
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'Inter, sans-serif',
                        fontSize: '0.875rem',
                        lineHeight: 1.6,
                        color: 'white',
                        fontWeight: 400
                      }}>
                        {message.content}
                      </Typography>
                    )}
                    <Typography variant="caption" sx={{ 
                      color: message.sender === 'user' ? 'rgba(255, 255, 255, 0.7)' : 'text.secondary',
                      fontFamily: 'Inter, sans-serif',
                      fontSize: '0.75rem',
                      mt: 1,
                      display: 'block'
                    }}>
                      {message.timestamp.toLocaleTimeString()}
                    </Typography>
                  </Box>
                }
              />
            </ListItem>
          ))}
          {loading && (
            <ListItem sx={{ mb: 2 }}>
              <ListItemAvatar sx={{ mr: 1 }}>
                <Avatar sx={{ 
                  bgcolor: 'secondary.main',
                  width: 40,
                  height: 40,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
                }}>
                  <BotIcon />
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                sx={{ margin: 0 }}
                primary={
                  <Box sx={{ 
                    background: 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)',
                    p: 2.5,
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    border: '1px solid rgba(0, 212, 255, 0.2)',
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
                    position: 'relative',
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      top: 15,
                      left: -8,
                      width: 0,
                      height: 0,
                      borderStyle: 'solid',
                      borderWidth: '8px 8px 8px 0',
                      borderColor: 'transparent #2a2a2a transparent transparent'
                    }
                  }}>
                    <CircularProgress size={18} sx={{ color: '#00d4ff' }} />
                    <Typography variant="body1" sx={{
                      fontFamily: 'Inter, sans-serif',
                      fontSize: '0.95rem',
                      color: 'text.primary'
                    }}>
                      {t('chat.thinking')}
                    </Typography>
                  </Box>
                }
              />
            </ListItem>
          )}
          <div ref={messagesEndRef} />
        </List>
      </Paper>

      {/* 输入框 */}
      <Box sx={{ 
        display: 'flex', 
        gap: 1.5,
        alignItems: 'flex-end',
        background: 'rgba(26, 31, 46, 0.8)',
        backdropFilter: 'blur(10px)',
        borderRadius: 2,
        p: 1.5,
        border: '1px solid rgba(0, 212, 255, 0.2)',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)'
      }}>
        <IconButton onClick={regenerate} disabled={loading || !lastUserMessageRef.current} title={t('chat.regenerate') as string}>
          <ReplayIcon />
        </IconButton>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={t('chat.inputPlaceholder')}
          disabled={loading}
          sx={{
            '& .MuiInputBase-root': {
              fontFamily: 'Inter, sans-serif',
              fontSize: '0.95rem',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: 1.5,
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                borderColor: 'rgba(0, 212, 255, 0.3)'
              },
              '&.Mui-focused': {
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                borderColor: '#00d4ff',
                boxShadow: '0 0 0 2px rgba(0, 212, 255, 0.2)'
              }
            },
            '& .MuiInputBase-input': {
              '&::placeholder': {
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: '0.95rem',
                fontFamily: 'Inter, sans-serif'
              }
            }
          }}
        />
        <Button
          variant="outlined"
          onClick={stopGenerating}
          disabled={!loading}
          startIcon={<StopIcon />}
          sx={{ 
            minWidth: 64,
            height: 54,
            borderRadius: 1.5,
          }}
        >
          {t('chat.stop')}
        </Button>
        <Button
          variant="contained"
          onClick={sendMessage}
          disabled={loading || !inputMessage.trim()}
          sx={{ 
            minWidth: 64,
            height: 54,
            borderRadius: 1.5,
            background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
            boxShadow: '0 4px 16px rgba(0, 212, 255, 0.3)',
            '&:hover': {
              background: 'linear-gradient(135deg, #1ae1ff 0%, #00b3e6 100%)',
              boxShadow: '0 6px 20px rgba(0, 212, 255, 0.4)',
              transform: 'translateY(-1px)'
            },
            '&:disabled': {
              background: 'rgba(0, 212, 255, 0.3)',
              boxShadow: 'none'
            }
          }}
        >
          <SendIcon />
        </Button>
      </Box>
    </Box>
  );
};

export default Chat; 
