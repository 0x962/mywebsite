import { useEffect, useState } from 'react';

/**
 * Demonstrates that any prefix routes to me by cycling through example
 * local-parts. The rendered text is also a working mailto: link, so a click
 * opens the user's mail app with whatever word is currently shown.
 */
const WORDS = [
  'hi', 'hello', 'hey', 'sup', 'ahoy', 'yes', 'whatever',
  'snowboard', 'obi', 'zuzu',
  'tea', 'litchi', 'namaste',
  'blah', 'argh', 'aaaaarrrrrghhhhh',
  'archer', 'canada', 'stranger',
  'anything', 'you', 'word',
];

const SWAP_MS = 2400;
const FADE_MS = 180;

export default function EmailRotator() {
  const [idx, setIdx] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const id = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIdx((i) => (i + 1) % WORDS.length);
        setFading(false);
      }, FADE_MS);
    }, SWAP_MS);
    return () => clearInterval(id);
  }, []);

  const word = WORDS[idx]!;

  return (
    <a className="email-rotator" href={`mailto:${word}@nvdk.co`} title="Any prefix routes to me">
      <span className="email-slot" data-fading={fading ? '' : null}>{word}</span>@nvdk.co
    </a>
  );
}
