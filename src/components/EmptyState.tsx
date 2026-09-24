const SUGGESTIONS = [
  'Объясни, чем отличается useEffect от useLayoutEffect',
  'Составь план изучения TypeScript на две недели',
  'Напиши регулярку для проверки e-mail и разбери её',
  'Придумай пять названий для кофейни у моря',
];

interface Props {
  onPick: (text: string) => void;
}

export function EmptyState({ onPick }: Props) {
  return (
    <section className="empty" aria-labelledby="empty-title">
      <h2 id="empty-title" className="empty-title">
        О чём поговорим?
      </h2>
      <p className="empty-lead">
        Задайте вопрос или выберите пример. Ответ появляется по мере того, как модель его пишет, — его можно
        остановить в любой момент.
      </p>
      <ul className="suggestions">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button type="button" className="suggestion" onClick={() => onPick(s)}>
              {s}
            </button>
          </li>
        ))}
      </ul>
      <p className="empty-note">
        Работает на бесплатной модели через OpenRouter: иногда она бывает перегружена и просит подождать.
        История живёт до закрытия вкладки.
      </p>
    </section>
  );
}
