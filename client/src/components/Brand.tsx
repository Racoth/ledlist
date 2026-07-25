import { Link } from 'react-router-dom';

/**
 * Знак: три субпикселя — красный, зелёный, синий. Из них собран любой цвет
 * на LED-экране; это единственный декоративный элемент интерфейса.
 */
export function Brand({ as = 'link' }: { as?: 'link' | 'plain' }) {
  const inner = (
    <>
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      LED<em>·</em>LIST
    </>
  );
  if (as === 'plain') return <div className="brand">{inner}</div>;
  return <Link className="brand" to="/">{inner}</Link>;
}
