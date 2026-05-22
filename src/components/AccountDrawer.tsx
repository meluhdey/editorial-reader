import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { X, LogOut, Check, Copy, User } from 'lucide-react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import Auth from './Auth';
import type { User as SupabaseUser } from '@supabase/supabase-js';

interface AccountDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  user: SupabaseUser | null;
  onLogout: () => void;
  onLoginSuccess: () => void;
  articleCount: number;
  noteCount: number;
}

const SQL_SETUP_SCRIPT = `-- 1. Create articles table
create table public.articles (
  id text primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete cascade not null,
  title text not null,
  author text,
  content text not null,
  url text not null,
  tags jsonb default '[]'::jsonb not null,
  header_image_url text,
  highlights jsonb default '[]'::jsonb not null,
  notes text default '' not null,
  saved_at bigint not null
);

-- Enable Row-Level Security
alter table public.articles enable row level security;

-- Articles RLS Policies
create policy "Users can perform all actions on their own articles"
  on public.articles for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Create notebook_notes table
create table public.notebook_notes (
  id text primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete cascade not null,
  title text not null,
  content text not null,
  created_at bigint not null,
  updated_at bigint not null
);

-- Enable Row-Level Security
alter table public.notebook_notes enable row level security;

-- Notebook Notes RLS Policies
create policy "Users can perform all actions on their own notes"
  on public.notebook_notes for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);`;

export default function AccountDrawer({
  isOpen,
  onClose,
  user,
  onLogout,
  onLoginSuccess,
  articleCount,
  noteCount,
}: AccountDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | null>(null);
  const configured = isSupabaseConfigured();

  const handleCopySql = () => {
    navigator.clipboard.writeText(SQL_SETUP_SCRIPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Close auth subview if drawer closes
  useEffect(() => {
    if (!isOpen) {
      setAuthMode(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop overlay */}
      <div className="drawer-overlay" onClick={onClose} />

      {/* Slide pane */}
      <motion.div
        className="account-drawer"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 220 }}
      >
        <div className="account-drawer-header">
          <div className="account-drawer-header-left">
            <User size={16} />
            <span className="account-drawer-title">
              {user ? 'YOUR PROFILE' : 'GUEST PROFILE'}
            </span>
          </div>
          <button className="account-drawer-close" onClick={onClose} aria-label="Close panel">
            <X size={18} />
          </button>
        </div>

        <div className="account-drawer-content">
          {authMode ? (
            /* Sub-view: Sign In or Sign Up Form */
            <Auth
              initialMode={authMode}
              onSuccess={() => {
                onLoginSuccess();
                setAuthMode(null);
              }}
              onCancel={() => setAuthMode(null)}
            />
          ) : !configured ? (
            /* Scenario A: Supabase has not been configured in .env */
            <div className="drawer-setup-pane">
              <div className="drawer-setup-alert">
                <span className="setup-alert-symbol">✦</span>
                <div>
                  <h3 className="setup-alert-title">DATABASE SETUP REQUIRED</h3>
                  <p className="setup-alert-desc">
                    Connect Footnotes to your own Supabase database to save articles and notes permanently across all devices.
                  </p>
                </div>
              </div>

              <div className="drawer-setup-step">
                <span className="step-num">01.</span>
                <p>
                  Create a new project in your <a href="https://supabase.com" target="_blank" rel="noreferrer">Supabase Console</a> and retrieve your API connection credentials.
                </p>
              </div>

              <div className="drawer-setup-step">
                <span className="step-num">02.</span>
                <p>
                  Create a file named <code>.env</code> in the root of this project and add your details:
                </p>
                <pre className="env-code-block">
                  {`VITE_SUPABASE_URL=https://your-project.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsIn...`}
                </pre>
              </div>

              <div className="drawer-setup-step">
                <span className="step-num">03.</span>
                <p>
                  Run these database commands in your Supabase SQL Editor to create the required tables and configure Row-Level Security:
                </p>
                <div className="sql-box">
                  <div className="sql-box-header">
                    <span>schema.sql</span>
                    <button className="sql-copy-btn" onClick={handleCopySql}>
                      {copied ? <Check size={12} className="success-color" /> : <Copy size={12} />}
                      <span>{copied ? 'COPIED!' : 'COPY SQL'}</span>
                    </button>
                  </div>
                  <pre className="sql-code-block">{SQL_SETUP_SCRIPT}</pre>
                </div>
              </div>

              <div className="drawer-setup-footer">
                <p>
                  Currently running in <strong>Local Guest Mode</strong>. All data is saved inside your browser's Local Storage.
                </p>
              </div>
            </div>
          ) : user ? (
            /* Scenario B: Configured and Logged In */
            <div className="drawer-profile-pane">
              <div className="drawer-user-card">
                <div className="drawer-user-avatar">
                  <User size={24} />
                </div>
                <div className="drawer-user-info">
                  {user.user_metadata?.first_name ? (
                    <span className="user-fullname">
                      {user.user_metadata.first_name} {user.user_metadata.last_name || ''}
                    </span>
                  ) : (
                    <span className="user-fullname">
                      {user.email?.split('@')[0]}
                    </span>
                  )}
                  <span className="user-email">{user.email}</span>
                </div>
              </div>

              <div className="drawer-stats">
                <div className="drawer-stat-item">
                  <span className="stat-value">{articleCount}</span>
                  <span className="stat-label">SAVED ARTICLES</span>
                </div>
                <div className="drawer-stat-item">
                  <span className="stat-value">{noteCount}</span>
                  <span className="stat-label">NOTEBOOK NOTES</span>
                </div>
              </div>

              <button className="drawer-logout-btn" onClick={onLogout} style={{ marginTop: '24px' }}>
                <LogOut size={16} />
                <span>LOG OUT</span>
              </button>
            </div>
          ) : (
            /* Scenario C: Configured but Logged Out */
            <div className="drawer-login-prompt">
              <div className="drawer-prompt-graphic">
                <User size={32} />
              </div>
              <h3>YOUR ACCOUNT</h3>
              <p>Create an account or sign in to save your personal articles, highlights, and notebook notes.</p>

              <div className="drawer-prompt-actions" style={{ marginTop: '24px' }}>
                <button className="drawer-primary-btn" onClick={() => setAuthMode('signup')}>
                  CREATE ACCOUNT
                </button>
                <button className="drawer-secondary-btn" onClick={() => setAuthMode('signin')}>
                  SIGN IN
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
