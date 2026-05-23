'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => {
    const saved = (typeof window !== 'undefined' && window.localStorage.getItem('reflex-theme')) as
      | 'dark' | 'light' | null;
    const initial = saved || 'dark';
    setTheme(initial);
    document.documentElement.setAttribute('data-theme', initial);
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { window.localStorage.setItem('reflex-theme', next); } catch {}
  };
  return (
    <button
      onClick={toggle}
      className="btn text-xs py-1 px-2.5"
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? '◐ light' : '◑ dark'}
    </button>
  );
}
