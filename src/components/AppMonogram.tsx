import { monogramColor, monogramLetter } from './Icons';

interface AppMonogramProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = { sm: 36, md: 56, lg: 80 };

export function AppMonogram({ name, size = 'md', className = '' }: AppMonogramProps) {
  const px = sizes[size];
  return (
    <div
      className={`app-monogram app-monogram--${size} ${className}`}
      style={{ backgroundColor: monogramColor(name), width: px, height: px, fontSize: px * 0.45 }}
      aria-hidden
    >
      {monogramLetter(name)}
    </div>
  );
}

export function AppCover({ name, iconUrl, size = 'md' }: { name: string; iconUrl?: string; size?: 'sm' | 'md' | 'lg' }) {
  if (iconUrl) {
    return <img src={iconUrl} alt={name} className={`app-cover-img app-cover-img--${size}`} loading="lazy" />;
  }
  return <AppMonogram name={name} size={size} />;
}
