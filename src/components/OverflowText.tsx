import { useRef, useState, useEffect } from "react";

interface OverflowTextProps {
  text: string;
  className?: string;
}

export default function OverflowText({ text, className = "" }: OverflowTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [scrollPosition, setScrollPosition] = useState<'start' | 'middle' | 'end'>('start');

  useEffect(() => {
    const checkOverflow = () => {
      if (containerRef.current && textRef.current) {
        setIsOverflowing(textRef.current.scrollWidth > containerRef.current.clientWidth);
      }
    };

    checkOverflow();
    window.addEventListener("resize", checkOverflow);
    return () => window.removeEventListener("resize", checkOverflow);
  }, [text]);

  useEffect(() => {
    const textElement = textRef.current;
    if (!textElement) return;

    const handleScroll = () => {
      const { scrollLeft, scrollWidth, clientWidth } = textElement;
      const maxScroll = scrollWidth - clientWidth;

      if (scrollLeft <= 1) {
        setScrollPosition('start');
      } else if (scrollLeft >= maxScroll - 1) {
        setScrollPosition('end');
      } else {
        setScrollPosition('middle');
      }
    };

    textElement.addEventListener('scroll', handleScroll);
    handleScroll();

    return () => textElement.removeEventListener('scroll', handleScroll);
  }, [isOverflowing]);

  const getMaskImage = () => {
    if (!isOverflowing) return 'none';
    
    if (scrollPosition === 'start') {
      return 'linear-gradient(to right, black 0%, black calc(100% - 40px), transparent 100%)';
    } else if (scrollPosition === 'end') {
      return 'linear-gradient(to left, black 0%, black calc(100% - 40px), transparent 100%)';
    } else {
      return 'linear-gradient(to right, transparent 0%, black 40px, black calc(100% - 40px), transparent 100%)';
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
    >
      <div
        ref={textRef}
        className="whitespace-nowrap select-text overflow-x-auto scrollbar-hide"
        style={{
          WebkitOverflowScrolling: "touch",
          maskImage: getMaskImage(),
          WebkitMaskImage: getMaskImage(),
        }}
      >
        {text}
      </div>
    </div>
  );
}

