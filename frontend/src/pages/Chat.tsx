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
        content: t('chat.welcome'),
        sender: 'bot',
        timestamp: new Date(),
      },
    ]);
  }, [t]);

  // 发送消息
  const sendMessage = async () => {
    if (!inputMessage.trim()) return;
    
    if (!selectedKb) {
      setError(t('chat.selectKnowledgeBaseFirst'));
      return;
    }

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
      const response = await chatApi.sendMessage({
        message: inputMessage,
        knowledge_base_id: selectedKb,
      });

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: response.data.response,
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
    <Box sx={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
          {t('chat.title')}
        </Typography>
        
        <FormControl sx={{ minWidth: 200 }}>
          <InputLabel>{t('chat.selectKnowledgeBase')}</InputLabel>
          <Select
            value={selectedKb}
            label={t('chat.selectKnowledgeBase')}
            onChange={(e) => setSelectedKb(e.target.value)}
          >
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
      <Paper sx={{ flex: 1, overflow: 'auto', mb: 2 }}>
        <List sx={{ p: 1 }}>
          {messages.map((message) => (
            <ListItem key={message.id} sx={{ alignItems: 'flex-start' }}>
              <ListItemAvatar>
                <Avatar sx={{ 
                  bgcolor: message.sender === 'user' ? 'primary.main' : 'secondary.main' 
                }}>
                  {message.sender === 'user' ? <PersonIcon /> : <BotIcon />}
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Box sx={{ 
                    bgcolor: message.sender === 'user' ? 'primary.100' : 'grey.100',
                    p: 2,
                    borderRadius: 2,
                    maxWidth: '70%',
                    ml: message.sender === 'user' ? 'auto' : 0,
                    mr: message.sender === 'user' ? 0 : 'auto',
                  }}>
                    <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                      {message.content}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {message.timestamp.toLocaleTimeString()}
                    </Typography>
                  </Box>
                }
              />
            </ListItem>
          ))}
          {loading && (
            <ListItem>
              <ListItemAvatar>
                <Avatar sx={{ bgcolor: 'secondary.main' }}>
                  <BotIcon />
                </Avatar>
              </ListItemAvatar>
              <ListItemText
                primary={
                  <Box sx={{ 
                    bgcolor: 'grey.100',
                    p: 2,
                    borderRadius: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                  }}>
                    <CircularProgress size={16} />
                    <Typography variant="body1">
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
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          multiline
          maxRows={4}
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={t('chat.inputPlaceholder')}
          disabled={loading}
        />
        <Button
          variant="contained"
          onClick={sendMessage}
          disabled={loading || !inputMessage.trim()}
          sx={{ minWidth: 64 }}
        >
          <SendIcon />
        </Button>
      </Box>
    </Box>
  );
};

export default Chat; 