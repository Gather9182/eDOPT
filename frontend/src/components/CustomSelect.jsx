import React, { Children, isValidElement, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

const optionText = node => typeof node === 'string' || typeof node === 'number'
  ? String(node)
  : Children.toArray(node).map(child => isValidElement(child) ? optionText(child.props.children) : String(child)).join('');

export default function CustomSelect(props) {
  // List boxes retain their existing Ctrl/Shift multi-selection behavior.
  return props.multiple || props.size ? <select {...props} /> : <SingleSelect {...props} />;
}

function SingleSelect({ children, value, defaultValue = '', onChange, disabled, className = '', style, ...props }) {
  const options = Children.toArray(children).filter(isValidElement).map(child => ({
    value: String(child.props.value ?? optionText(child.props.children)),
    label: optionText(child.props.children),
    disabled: Boolean(child.props.disabled),
  }));
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = String(value ?? internalValue);
  const selectedIndex = options.findIndex(option => option.value === selectedValue);
  const selected = options[selectedIndex] || options[0];
  const [menu, setMenu] = useState(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const searchRef = useRef({ text: '', time: 0 });
  const listId = useId();
  const open = Boolean(menu) && !disabled;

  useEffect(() => {
    if (!open) return;
    const dismiss = event => {
      if (!buttonRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setMenu(null);
    };
    const close = () => setMenu(null);
    const scroll = event => {
      if (!menuRef.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const show = (index = selectedIndex) => {
    if (disabled || !options.length) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upwards = below < Math.min(280, options.length * 42 + 12) && above > below;
    const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 24);
    setMenu({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      width,
      maxHeight: Math.min(320, upwards ? above : below),
      ...(upwards ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
    });
    setActiveIndex(index >= 0 && !options[index]?.disabled ? index : options.findIndex(option => !option.disabled));
  };

  const choose = index => {
    const option = options[index];
    if (!option || option.disabled) return;
    setInternalValue(option.value);
    if (option.value !== selectedValue) {
      const target = { value: option.value, name: props.name, id: props.id };
      onChange?.({ target, currentTarget: target });
    }
    setMenu(null);
    buttonRef.current?.focus();
  };

  const onKeyDown = event => {
    const enabled = options.map((option, i) => option.disabled ? -1 : i).filter(i => i >= 0);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const current = enabled.indexOf(activeIndex);
      const next = event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled.at(-1)
        : enabled[(current + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length];
      if (!open) show(event.key === 'Home' || event.key === 'End' ? next : selectedIndex);
      else setActiveIndex(next ?? -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(activeIndex); else show();
    } else if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setMenu(null); }
    } else if (event.key === 'Tab') {
      setMenu(null);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      const text = (now - searchRef.current.time < 700 ? searchRef.current.text : '') + event.key.toLocaleLowerCase();
      searchRef.current = { text, time: now };
      const index = options.findIndex(option => !option.disabled && option.label.toLocaleLowerCase().startsWith(text));
      if (index >= 0) { if (!open) show(index); else setActiveIndex(index); }
    }
  };

  return <span className="custom-select" style={style}>
    <button {...props} ref={buttonRef} type="button" role="combobox" disabled={disabled}
      className={`form-input custom-select-trigger ${className}`} aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      onClick={() => open ? setMenu(null) : show()} onKeyDown={onKeyDown}>
      <span className="custom-select-value">{selected?.label || 'Bitte auswählen'}</span>
      <ChevronDown size={16} aria-hidden="true" className={open ? 'custom-select-chevron is-open' : 'custom-select-chevron'} />
    </button>
    {props.name && <input type="hidden" name={props.name} value={selected?.value || ''} disabled={disabled} />}
    {open && createPortal(<div ref={menuRef} id={listId} role="listbox"
      aria-label={props['aria-label'] || 'Auswahl'} className="custom-select-menu" style={menu}>
      {options.map((option, index) => <div key={`${option.value}-${index}`} id={`${listId}-${index}`}
        role="option" aria-selected={selected?.value === option.value} aria-disabled={option.disabled || undefined}
        data-active={activeIndex === index} className="custom-select-option"
        onPointerMove={() => { if (!option.disabled) setActiveIndex(index); }}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <span className="custom-select-check">{selected?.value === option.value && <Check size={16} aria-hidden="true" />}</span>
        <span>{option.label}</span>
      </div>)}
    </div>, document.body)}
  </span>;
}
