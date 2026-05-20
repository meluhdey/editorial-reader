import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Article } from '../types';

interface SpotlightProps {
  open: boolean;
  onClose: () => void;
  onAdd: (article: Article) => void;
  onOpen: (id: string) => void;
}

type Stage = 'idle' | 'fetching' | 'extracting' | 'done' | 'error';

const STAGE_MESSAGES: Record<Stage, string> = {
  idle: '',
  fetching: 'Fetching article…',
  extracting: 'Extracting content…',
  done: 'Done',
  error: '',
};

export default function Spotlight({ open, onClose, onAdd, onOpen }: SpotlightProps) {
  const [url, setUrl] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
      setUrl('');
      setStage('idle');
      setError('');
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleLoad = async () => {
    const trimmed = url.trim();
    if (!trimmed || stage === 'fetching' || stage === 'extracting') return;

    setError('');
    setStage('fetching');

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      setStage('extracting');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load article');
      const article = data as Article;
      onAdd(article);
      setStage('done');
      setTimeout(() => {
        onOpen(article.id);
        onClose();
      }, 500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  };

  const isLoading = stage === 'fetching' || stage === 'extracting';

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="spotlight-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
          />

          {/* Panel — outer div owns the centering, motion.div owns the animation */}
          <div className="spotlight-positioner">
            <motion.div
              className="spotlight-panel"
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
            <div className={`spotlight-input-row ${isLoading ? 'spotlight-input-row--loading' : ''}`}>
              {(isLoading || stage === 'done') && (
                <span className="spotlight-icon">
                  {isLoading ? (
                    <span className="spotlight-spinner" />
                  ) : (
                    '✓'
                  )}
                </span>
              )}
              <input
                ref={inputRef}
                className="spotlight-input"
                type="url"
                placeholder="Paste article URL…"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setStage('idle'); setError(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
                disabled={isLoading || stage === 'done'}
              />
              {url && !isLoading && stage !== 'done' && (
                <kbd className="spotlight-hint">OPEN</kbd>
              )}
            </div>

            <AnimatePresence>
              {(isLoading || stage === 'done') && (
                <motion.div
                  className="spotlight-status"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="spotlight-progress">
                    <motion.div
                      className="spotlight-progress-bar"
                      initial={{ width: '0%' }}
                      animate={{ width: stage === 'fetching' ? '40%' : stage === 'extracting' ? '80%' : '100%' }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                  </div>
                  <span className="spotlight-status-text">{STAGE_MESSAGES[stage]}</span>
                </motion.div>
              )}
              {stage === 'error' && (
                <motion.div
                  className="spotlight-error"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
