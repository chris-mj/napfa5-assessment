import sitUpUrl from './sit-up.svg';
import broadJumpUrl from './broad-jump.svg';
import sitReachUrl from './sit-reach.svg';
import pullUpUrl from './pull-up.svg';
import pushUpUrl from './pushup.svg';

export function IconBase({ children, className = 'w-4 h-4', ...rest }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function SitupsIcon({ className = 'w-4 h-4', alt = 'Sit-ups', ...rest }) {
  return <img src={sitUpUrl} alt={alt} className={className} {...rest} />
}
export function BroadJumpIcon({ className = 'w-4 h-4', alt = 'Broad Jump', ...rest }) {
  return <img src={broadJumpUrl} alt={alt} className={className} {...rest} />
}
export function ReachIcon({ className = 'w-4 h-4', alt = 'Sit & Reach', ...rest }) {
  return <img src={sitReachUrl} alt={alt} className={className} {...rest} />
}
export function PullupsIcon({ className = 'w-4 h-4', alt = 'Pull-ups', ...rest }) {
  return <img src={pullUpUrl} alt={alt} className={className} {...rest} />
}
export function PushupsIcon({ className = 'w-4 h-4', alt = 'Push-ups', ...rest }) {
  return <img src={pushUpUrl} alt={alt} className={className} {...rest} />
}
export function ShuttleIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="13" r="9" />
      <path d="M12 7v6l4 2" />
      <path d="M10 2h4" />
    </IconBase>
  );
}
