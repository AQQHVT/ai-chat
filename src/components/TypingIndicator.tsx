export function TypingIndicator({ thinking = false }: { thinking?: boolean }) {
  return (
    <p className="typing">
      <span className="typing-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {thinking ? 'Модель думает…' : 'Модель печатает…'}
    </p>
  );
}
