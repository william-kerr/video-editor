import type { ButtonHTMLAttributes } from 'react'
import { Icon } from './Icon'
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { icon?: string; tip?: string }
export function Button({ icon, tip, className = '', children, ...props }: Props) {
  return <button type="button" className={`button ${children ? 'text-button' : 'icon-button'} ${className}`} data-tip={tip} aria-label={props['aria-label'] || tip} {...props}>{icon && <Icon name={icon} />}{children}</button>
}
