import { useState } from 'react'
import { ChevronDown, Eye } from 'lucide-react'

export function Panel({ children, className = '', ...props }) {
  return <section className={`panel ${className}`} {...props}>{children}</section>
}

export function SectionTitle({ title }) {
  return <h3 className="section-title">{title}</h3>
}

export function Badge({ children, tone = 'blue' }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function Metric({ value, label, note, tone }) {
  return <Panel className={`metric ${tone}`}><small>{label}</small><strong>{value}</strong><span>{note}</span></Panel>
}

export function Toggle({ defaultOn = false, value, onChange, disabled = false }) {
  const [internal, setInternal] = useState(defaultOn)
  const on = value ?? internal
  return <button type="button" aria-pressed={on} disabled={disabled} className={`toggle ${on ? 'on' : ''}`} onClick={(event) => { event.stopPropagation(); if (onChange) onChange(!on); else setInternal(!on) }}><i /></button>
}

export function Segmented({ options, value, onChange, compact = false }) {
  return <div className={`segmented ${compact ? 'compact' : ''}`}>{options.map((option) => <button className={value === option ? 'active' : ''} onClick={() => onChange(option)} key={option}>{option}</button>)}</div>
}

export function InputLabel({ label, value, secret, placeholder }) {
  const [current, setCurrent] = useState(value)
  const [show, setShow] = useState(false)
  return <label className="field-label">{label}<span className="input-wrap"><input type={secret && !show ? 'password' : 'text'} value={current} placeholder={placeholder} onChange={(event) => setCurrent(event.target.value)} />{secret && <button type="button" onClick={() => setShow(!show)}><Eye size={14} /></button>}</span></label>
}

export function SelectLabel({ label, options }) {
  return <label className="field-label">{label}<span className="select-wrap"><select>{options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={13} /></span></label>
}

export function SelectField({ value, onChange, options }) {
  return <span className="select-wrap standalone"><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={13} /></span>
}
