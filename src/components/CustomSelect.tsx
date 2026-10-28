import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
}

const MENU_GAP = 8;
const MENU_PREFERRED_HEIGHT = 256;
const MENU_MIN_HEIGHT = 96;

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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);
  const isCompact = size === "sm";

  // The menu is rendered in a portal so surrounding cards and scroll containers
  // cannot clip it.
  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const spaceAbove = rect.top - MENU_GAP;
    const openUpwards = spaceBelow < Math.min(MENU_PREFERRED_HEIGHT, 160) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      MENU_MIN_HEIGHT,
      Math.min(MENU_PREFERRED_HEIGHT, openUpwards ? spaceAbove : spaceBelow),
    );

    setMenuPosition({
      top: openUpwards ? rect.top - MENU_GAP - maxHeight : rect.bottom + MENU_GAP,
      left: rect.left,
      width: rect.width,
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setMenuPosition(null);
      return;
    }

    updateMenuPosition();
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    const handleReposition = () => updateMenuPosition();

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          w-full bg-white border rounded-lg
          flex items-center justify-between gap-3
          transition-all duration-200
          ${isCompact ? "px-3 py-1.5 text-sm" : "px-4 py-2.5"}
          ${disabled 
            ? "opacity-50 cursor-not-allowed bg-gray-50" 
            : "hover:border-primary-400 cursor-pointer"
          }
          ${isOpen 
            ? "border-primary-500 ring-2 ring-primary-200" 
            : "border-gray-300"
          }
        `}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selectedOption?.icon && (
            <span className="flex-shrink-0">{selectedOption.icon}</span>
          )}
          <span className="text-gray-900 font-medium truncate">
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

      {isOpen && menuPosition && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{
            position: "fixed",
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: menuPosition.maxHeight,
          }}
          className="z-[9999] overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-xl scrollbar-thin"
        >
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(option.value)}
                className={`
                  w-full flex items-center gap-3
                  transition-colors duration-150
                  ${isCompact ? "px-3 py-1.5 text-sm" : "px-4 py-2.5"}
                  ${isSelected
                    ? "bg-primary-50 text-primary-700"
                    : "hover:bg-gray-50 text-gray-900"
                  }
                `}
              >
                {option.icon && (
                  <span className="flex-shrink-0">{option.icon}</span>
                )}
                <span className="flex-1 text-left font-medium truncate">
                  {option.label}
                </span>
                {isSelected && (
                  <Check size={isCompact ? 14 : 18} className="flex-shrink-0 text-primary-600" />
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}



