import { useEffect, useState, useCallback } from 'react';
import { MessageSquarePlus, Inbox, LoaderCircle, X, Check } from 'lucide-react';
import { Button } from './ui/button';
import { getChannelInfo, getSuggestions, sendSuggestion } from '../api/sdk.gen';
import { toast } from 'react-toastify';

interface SuggestionBannerProps {
  sessionId: string;
  onAcceptSuggestion: (text: string) => void;
}

export default function SuggestionBanner({ sessionId, onAcceptSuggestion }: SuggestionBannerProps) {
  const [role, setRole] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ text: string; eventId: string; timestamp: number }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showSendInput, setShowSendInput] = useState(false);
  const [suggestionText, setSuggestionText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Check if this session has a channel
  useEffect(() => {
    let cancelled = false;
    getChannelInfo({ path: { session_id: sessionId }, throwOnError: false })
      .then((resp) => {
        if (!cancelled && resp.data) {
          setRole(resp.data.role);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId]);

  // For owners, poll for suggestions on mount and every 30s
  useEffect(() => {
    if (role !== 'owner') return;

    const fetchSuggestions = async () => {
      setIsLoading(true);
      try {
        const resp = await getSuggestions({ path: { session_id: sessionId }, throwOnError: false });
        if (resp.data) {
          setSuggestions(resp.data);
        }
      } catch {
      } finally {
        setIsLoading(false);
      }
    };

    fetchSuggestions();
    const interval = setInterval(fetchSuggestions, 30000);
    return () => clearInterval(interval);
  }, [role, sessionId]);

  const handleSend = useCallback(async () => {
    if (!suggestionText.trim()) return;
    setIsSending(true);
    try {
      await sendSuggestion({
        path: { session_id: sessionId },
        body: { text: suggestionText.trim() },
        throwOnError: true,
      });
      setSuggestionText('');
      setShowSendInput(false);
      toast.success('Suggestion sent');
    } catch (error) {
      toast.error('Failed to send suggestion');
    } finally {
      setIsSending(false);
    }
  }, [sessionId, suggestionText]);

  const handleAccept = useCallback((suggestion: { text: string; eventId: string }) => {
    setSuggestions((prev) => prev.filter((s) => s.eventId !== suggestion.eventId));
    onAcceptSuggestion(suggestion.text);
  }, [onAcceptSuggestion]);

  const handleDismiss = useCallback((eventId: string) => {
    setSuggestions((prev) => prev.filter((s) => s.eventId !== eventId));
  }, []);

  if (!role) return null;

  // Participant: show "send suggestion" button
  if (role === 'participant') {
    if (showSendInput) {
      return (
        <div className="mx-4 mb-2 rounded-lg border border-border-primary bg-background-secondary p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-2">
              <MessageSquarePlus className="w-4 h-4" />
              Send suggestion to sharer
            </span>
            <button onClick={() => setShowSendInput(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
              <X className="w-4 h-4 text-text-secondary" />
            </button>
          </div>
          <textarea
            className="w-full min-h-[60px] rounded border border-border-primary bg-background-primary p-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Type your suggestion..."
            value={suggestionText}
            onChange={(e) => setSuggestionText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleSend();
              }
            }}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleSend} disabled={!suggestionText.trim() || isSending}>
              {isSending ? <LoaderCircle className="w-4 h-4 animate-spin mr-1" /> : null}
              Send
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-4 mb-2">
        <button
          onClick={() => setShowSendInput(true)}
          className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          <MessageSquarePlus className="w-4 h-4" />
          Send a suggestion to the person who shared this session
        </button>
      </div>
    );
  }

  // Owner: show incoming suggestions
  if (role === 'owner') {
    if (isLoading && suggestions.length === 0) return null; // don't flash loading on first render

    if (suggestions.length === 0) return null; // nothing to show

    return (
      <div className="mx-4 mb-2 space-y-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.eventId}
            className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Inbox className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    Suggestion received
                  </span>
                  <span className="text-xs text-text-secondary">
                    {new Date(suggestion.timestamp * 1000).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-text-primary whitespace-pre-wrap">{suggestion.text}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDismiss(suggestion.eventId)}
              >
                <X className="w-3 h-3 mr-1" />
                Dismiss
              </Button>
              <Button
                size="sm"
                onClick={() => handleAccept(suggestion)}
              >
                <Check className="w-3 h-3 mr-1" />
                Accept & run
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
}
