import { useId, useState } from 'react'

const STATE_LABELS = {
  idle: 'Vesper Agent',
  waiting: 'Agent 等待输入',
  thinking: 'Agent 思考中',
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function AgentStatusAvatar({ state = 'idle', size = 32, className = '' }) {
  const [gaze, setGaze] = useState({ x: 0, y: 0 })
  const id = useId().replaceAll(':', '')
  const gradientId = `agent-orb-${id}`
  const haloId = `agent-halo-${id}`
  const shadowId = `agent-shadow-${id}`
  const resolvedState = STATE_LABELS[state] ? state : 'idle'
  const label = STATE_LABELS[resolvedState]

  const updateGaze = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = clamp(((event.clientX - rect.left) / rect.width - 0.5) * 2.4, -1.2, 1.2)
    const y = clamp(((event.clientY - rect.top) / rect.height - 0.5) * 1.8, -0.9, 0.9)
    setGaze({ x, y })
  }

  return (
    <span
      className={`agent-status-avatar is-${resolvedState} ${className}`.trim()}
      data-state={resolvedState}
      role="img"
      aria-label={label}
      title={label}
      style={{
        '--agent-avatar-size': `${size}px`,
        '--agent-gaze-x': `${gaze.x}px`,
        '--agent-gaze-y': `${gaze.y}px`,
      }}
      onPointerMove={updateGaze}
      onPointerLeave={() => setGaze({ x: 0, y: 0 })}
    >
      <svg viewBox="0 0 36 36" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id={gradientId} cx="10" cy="8" r="31" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#75E5FF" />
            <stop offset="0.38" stopColor="#4EA4FF" />
            <stop offset="0.72" stopColor="#5F72F6" />
            <stop offset="1" stopColor="#8A63F6" />
          </radialGradient>
          <linearGradient id={haloId} x1="5" y1="5" x2="31" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#84EEFF" />
            <stop offset="0.5" stopColor="#6797FF" />
            <stop offset="1" stopColor="#A36CFF" />
          </linearGradient>
          <filter id={shadowId} x="-45%" y="-45%" width="190%" height="190%" colorInterpolationFilters="sRGB">
            <feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor="#4E78E8" floodOpacity="0.34" />
          </filter>
        </defs>

        <circle className="agent-status-halo" cx="18" cy="18" r="16" fill="none" stroke={`url(#${haloId})`} strokeWidth="1.3" />
        <g className="agent-status-orb-shell" filter={`url(#${shadowId})`}>
          <circle className="agent-status-orb" cx="18" cy="18" r="14.5" fill={`url(#${gradientId})`} />
          <ellipse className="agent-status-highlight" cx="12.2" cy="9.6" rx="7.4" ry="4.8" fill="#FFFFFF" opacity="0.16" transform="rotate(-18 12.2 9.6)" />
          <path className="agent-status-soft-light" d="M5.8 20.8C8.7 27.7 16.9 31.1 24.3 28.1C27.7 26.8 30.3 24.1 31.6 20.9C30.2 28.1 23.9 32.5 17.3 32.5C10.9 32.5 5.7 28.6 4.1 23.3C3.8 22.1 4.8 20.5 5.8 20.8Z" fill="#3454C9" opacity="0.18" />
        </g>

        <g className="agent-status-gaze">
          <g className="agent-status-eyes" fill="#FFFFFF">
            <rect x="11.1" y="13" width="3.5" height="8.2" rx="1.75" />
            <rect x="21.4" y="13" width="3.5" height="8.2" rx="1.75" />
          </g>
        </g>
      </svg>
    </span>
  )
}
