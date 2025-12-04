'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChatConversation,
  ChatMessage,
  getConversation,
  listConversations,
  queryAgent,
} from '../../lib/api';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

export default function ChatPage() {
  const [chatConversations, setChatConversations] = useState<ChatConversation[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSelectedId, setChatSelectedId] = useState<string | null>(null);
  const [chatSubject, setChatSubject] = useState('Customer onboarding issue');
  const [chatCustomerId, setChatCustomerId] = useState('customer-123');
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatListLoading, setChatListLoading] = useState(false);
  const [chatConversationLoading, setChatConversationLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<ChatConversation | null>(null);

  const refreshConversations = useCallback(async () => {
    setChatListLoading(true);
    try {
      const data = await listConversations(25);
      setChatConversations(data);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Failed to fetch conversations');
    } finally {
      setChatListLoading(false);
    }
  }, []);

  const loadConversation = useCallback(async (conversationId: string) => {
    if (!conversationId) {
      return;
    }

    setChatSelectedId(conversationId);
    setChatConversationLoading(true);
    setChatError(null);
    try {
      const convo = await getConversation(conversationId);
      setActiveConversation(convo);
      setChatMessages(convo.messages ?? []);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Failed to fetch conversation');
    } finally {
      setChatConversationLoading(false);
    }
  }, []);

  const handleSelectConversation = useCallback(
    (conversationId: string) => {
      void loadConversation(conversationId);
    },
    [loadConversation],
  );

  const handleNewConversation = useCallback(() => {
    setChatSelectedId(null);
    setActiveConversation(null);
    setChatMessages([]);
    setChatInput('');
    setChatError(null);
  }, []);

  const handleSendChatMessage = useCallback(async () => {
    if (!chatInput.trim()) {
      return;
    }

    setChatLoading(true);
    setChatError(null);
    try {
      const payload: Parameters<typeof queryAgent>[0] = {
        query: chatInput.trim(),
      };
      if (chatSelectedId) {
        payload.conversationId = chatSelectedId;
      } else {
        if (chatSubject.trim()) {
          payload.subject = chatSubject.trim();
        }
        if (chatCustomerId.trim()) {
          payload.customerId = chatCustomerId.trim();
        }
      }

      const result = await queryAgent(payload);
      const resolvedConversationId = result.conversationId ?? chatSelectedId ?? null;

      if (resolvedConversationId) {
        await loadConversation(resolvedConversationId);
      }
      await refreshConversations();
      setChatInput('');
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Failed to send chat message');
    } finally {
      setChatLoading(false);
    }
  }, [
    chatCustomerId,
    chatInput,
    chatSelectedId,
    chatSubject,
    loadConversation,
    refreshConversations,
  ]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const chatHeading = useMemo(() => {
    if (activeConversation) {
      return activeConversation.subject || 'Untitled conversation';
    }
    return 'Start a new conversation';
  }, [activeConversation]);

  return (
    <main>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1>Customer Chat Console</h1>
        <p style={{ color: 'var(--muted)' }}>
          Manage live customer conversations powered by the LangGraph agent.
        </p>
        <Link href="/" className="ghost-button" style={{ display: 'inline-block', marginTop: '0.75rem' }}>
          ← Back to dashboard
        </Link>
      </header>

      <section>
        <div className="chat-layout">
          <div className="chat-sidebar">
            <div className="chat-sidebar-actions">
              <button type="button" className="ghost-button" onClick={handleNewConversation}>
                New Conversation
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => refreshConversations()}
                disabled={chatListLoading}
              >
                {chatListLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <div className="chat-thread-list">
              {chatConversations.length === 0 && !chatListLoading ? (
                <p style={{ color: 'var(--muted)' }}>No conversations yet.</p>
              ) : (
                <ul>
                  {chatConversations.map(convo => (
                    <li
                      key={convo.id}
                      className={`chat-thread-item${chatSelectedId === convo.id ? ' active' : ''}`}
                      onClick={() => handleSelectConversation(convo.id)}
                    >
                      <strong>{convo.subject || 'Untitled conversation'}</strong>
                      <span>Customer: {convo.customerId || 'n/a'}</span>
                      <small>
                        Updated:{' '}
                        {convo.lastMessageAt
                          ? new Date(convo.lastMessageAt).toLocaleString()
                          : new Date(convo.createdAt).toLocaleString()}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="chat-panel">
            <div className="chat-meta">
              <h3 style={{ margin: 0 }}>{chatHeading}</h3>
              {activeConversation ? (
                <>
                  <p style={{ margin: '0.25rem 0' }}>
                    <strong>Conversation ID:</strong> {activeConversation.id}
                  </p>
                  <p style={{ margin: '0.25rem 0', color: 'var(--muted)' }}>
                    Customer: {activeConversation.customerId || 'n/a'}
                  </p>
                </>
              ) : (
                <p style={{ color: 'var(--muted)', marginTop: '0.25rem' }}>
                  Provide a subject, customer ID (optional), and compose the first message to kick off a
                  chat.
                </p>
              )}
            </div>
            <div className="chat-messages">
              {chatConversationLoading ? (
                <p>Loading conversation...</p>
              ) : chatMessages.length === 0 ? (
                <p style={{ color: 'var(--muted)' }}>
                  {activeConversation ? 'No messages yet.' : 'Waiting for your first prompt.'}
                </p>
              ) : (
                chatMessages.map(message => (
                  <div key={message.id} className="chat-message">
                    <strong style={{ textTransform: 'capitalize' }}>
                      {message.role} · {new Date(message.createdAt).toLocaleTimeString()}
                    </strong>
                    <div style={{ marginTop: '0.25rem' }}>
                      <ReactMarkdown rehypePlugins={[rehypeRaw]} remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="chat-controls">
              {!chatSelectedId && (
                <div className="chat-controls-row">
                  <label>
                    Subject
                    <input
                      type="text"
                      value={chatSubject}
                      onChange={event => setChatSubject(event.target.value)}
                      placeholder='Password reset help'
                    />
                  </label>
                  <label>
                    Customer ID
                    <input
                      type="text"
                      value={chatCustomerId}
                      onChange={event => setChatCustomerId(event.target.value)}
                      placeholder="cust_123"
                    />
                  </label>
                </div>
              )}
              <label style={{ display: 'block', width: '100%' }}>
                Message
                <textarea
                  value={chatInput}
                  onChange={event => setChatInput(event.target.value)}
                  rows={3}
                  placeholder="Draft your next answer..."
                />
              </label>
              <button type="button" onClick={handleSendChatMessage} disabled={chatLoading || !chatInput.trim()}>
                {chatLoading ? 'Sending...' : chatSelectedId ? 'Send Reply' : 'Start Conversation'}
              </button>
              {chatError && <p className="error-text">{chatError}</p>}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
