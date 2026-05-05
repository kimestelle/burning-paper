'use client';

import { useState } from 'react';
import BurningPaper from './components/BurningPaper';
import EmberCursor from './components/Cursor';

const FADE = 500;
const OVERLAP = 120;

export default function Home() {
  const [message, setMessage] = useState('');
  const [paperVisible, setPaperVisible] = useState(true);
  const [paperKey, setPaperKey] = useState(0);

  function resetMessage() {
    setMessage('');
    setPaperVisible(false);
  }

  function generateNew() {
    setPaperKey((k) => k + 1);
    setMessage('');
    setPaperVisible(true);
  }

  return (
    <div className="relative flex w-[100svw] h-[100svh] flex-col items-center justify-center gap-5 bg-floral overflow-hidden">
      <div
        style={{
          opacity: paperVisible ? 1 : 0,
          pointerEvents: paperVisible ? 'auto' : 'none',
          transition: `opacity ${FADE}ms ease`,
        }}
      >
        <BurningPaper
          key={paperKey}
          label={message}
          onBurnComplete={resetMessage}
        />
      </div>

      <EmberCursor />

      <textarea
        placeholder="write something..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={!paperVisible}
        className="w-[300px] sm:w-[400px] md:w-[500px] h-[96px] resize-none overflow-y-auto bg-transparent px-4 py-8 text-center text-lg leading-8 text-stone-700 placeholder:text-stone-400 outline-none scrollbar-none"
        style={{
          opacity: paperVisible ? 1 : 0,
          pointerEvents: paperVisible ? 'auto' : 'none',
          transition: `opacity ${FADE}ms ease`,
        }}
      />

      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          opacity: paperVisible ? 0 : 1,
          pointerEvents: paperVisible ? 'none' : 'auto',
          transition: `opacity ${FADE}ms ease ${paperVisible ? '0ms' : `${FADE - OVERLAP}ms`}`,
        }}
        onClick={generateNew}
      >
        <h1 className="select-none text-stone-700 text-xl tracking-[0.2em] uppercase">
          almost sent
        </h1>
      </div>
    </div>
  );
}