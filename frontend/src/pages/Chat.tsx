import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
} from '@mui/material';
import {
  Send as SendIcon,
  SmartToy as BotIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { knowledgeBaseApi, chatApi } from '../services/api';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'bot';
  timestamp: Date;
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
        content: '您好！我是 RAG Platform 的智能助手。您可以选择知识库进行基于文档的问答，或者直接进行普通对话。',
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
    setInputMessage('');
    setLoading(true);
    setError(null);

    try {
      const requestData: any = {
        message: inputMessage,
      };
      
      // 只有选择了知识库才传递knowledge_base_id
      if (selectedKb) {
        requestData.knowledge_base_id = selectedKb;
      }

      const response = await chatApi.sendMessage(requestData);

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: response.data.message || response.data.response || '抱歉，我无法生成回复',
        sender: 'bot',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, botMessage]);
    } catch (error: any) {
      console.error('Failed to send message:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: t('chat.errorResponse'),
        sender: 'bot',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
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
              <em>普通对话（无知识库）</em>
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
                    <Typography variant="body1" sx={{ 
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'Inter, sans-serif',
                      fontSize: '0.95rem',
                      lineHeight: 1.6,
                      color: message.sender === 'user' ? 'white' : 'text.primary',
                      fontWeight: 400
                    }}>
                      {message.content}
                    </Typography>
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