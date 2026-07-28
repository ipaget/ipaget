import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Visual density for compact toolbars and table rows. */
  size?: "default" | "sm";
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUpward: boolean;
}

export default function CustomSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
  className = "",
  size = "default",
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const selectRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);
  const isCompact = size === "sm";

  const updateMenuPosition = () => {
    const buttonElement = buttonRef.current;
    if (!buttonElement) return;

    const buttonRect = buttonElement.getBoundingClientRect();
    const viewportPadding = 8;
    const preferredMaxHeight = 256;
    const spaceBelow = window.innerHeight - buttonRect.bottom - viewportPadding;
    const spaceAbove = buttonRect.top - viewportPadding;
    const openUpward = spaceBelow < 160 && spaceAbove > spaceBelow;
    const availableSpace = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(120, Math.min(preferredMaxHeight, availableSpace - 8));

    setMenuPosition({
      top: openUpward ? buttonRect.top - 8 : buttonRect.bottom + 8,
      left: buttonRect.left,
      width: buttonRect.width,
      maxHeight,
      openUpward,
    });
  };

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return;
    }

    updateMenuPosition();

    const handleReposition = () => updateMenuPosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const targetNode = event.target as Node;
      const clickedTrigger = selectRef.current?.contains(targetNode);
      const clickedMenu = menuRef.current?.contains(targetNode);
      if (!clickedTrigger && !clickedMenu) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  const menuContent =
    isOpen && menuPosition
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[1000] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl"
            style={{
              top: menuPosition.openUpward ? undefined : menuPosition.top,
              bottom: menuPosition.openUpward
                ? window.innerHeight - menuPosition.top
                : undefined,
              left: menuPosition.left,
              width: menuPosition.width,
              maxHeight: menuPosition.maxHeight,
            }}
          >
            <div className="overflow-y-auto py-1" style={{ maxHeight: menuPosition.maxHeight }}>
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={`
                      w-full flex items-center gap-3
                      transition-colors duration-150
                      ${isCompact ? "px-3 py-2" : "px-4 py-2.5"}
                      ${
                        isSelected
                          ? "bg-primary-50 text-primary-700"
                          : "hover:bg-gray-50 text-gray-900"
                      }
                    `}
                  >
                    {option.icon && <span className="flex-shrink-0">{option.icon}</span>}
                    <span className={`flex-1 truncate text-left font-normal ${isCompact ? "text-xs" : "text-sm"}`}>
                      {option.label}
                    </span>
                    {isSelected && (
                      <Check size={isCompact ? 14 : 18} className="flex-shrink-0 text-primary-600" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={selectRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          w-full bg-white border rounded-lg
          flex items-center justify-between gap-3
          transition-all duration-200
          ${isCompact ? "h-8 px-2.5 py-0" : "px-4 py-2.5"}
          ${
            disabled
              ? "opacity-50 cursor-not-allowed bg-gray-50"
              : "hover:border-primary-400 cursor-pointer"
          }
          ${isOpen ? "border-primary-500 ring-2 ring-primary-200" : "border-gray-300"}
        `}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {selectedOption?.icon && <span className="flex-shrink-0">{selectedOption.icon}</span>}
          <span className={`truncate text-gray-900 ${isCompact ? "text-xs font-normal" : "text-sm font-medium"}`}>
            {selectedOption?.label || placeholder}
          </span>
        </div>
        <ChevronDown
          size={isCompact ? 14 : 18}
          className={`flex-shrink-0 text-gray-500 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>
      {menuContent}
    </div>
  );
}
