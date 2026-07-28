import { Loader2 } from "lucide-react";
import { ButtonHTMLAttributes, ReactNode } from "react";

interface Button3DProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'accent' | 'dangerFilled';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
}

export default function Button3D({ 
  variant = 'primary', 
  size = 'md', 
  loading = false,
  disabled = false,
  className = '',
  children,
  ...props 
}: Button3DProps) {
  const baseClasses = "relative font-medium transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 inline-flex items-center justify-center gap-2";
  
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs rounded-md",
    md: "px-4 py-2 text-sm rounded-md",
    lg: "px-6 py-2.5 text-base rounded-md",
  };

  const variantClasses = {
    primary: "bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow",
    secondary: "bg-gray-100 hover:bg-gray-200 text-gray-900 shadow-sm hover:shadow",
    danger: "bg-gray-100 hover:bg-gray-200 text-red-600 shadow-sm hover:shadow",
    success: "bg-green-600 hover:bg-green-700 text-white shadow-sm hover:shadow",
    accent: "bg-blue-100 hover:bg-blue-200 text-blue-600 shadow-sm hover:shadow",
    dangerFilled: "bg-pink-100 hover:bg-pink-200 text-red-600 shadow-sm hover:shadow",
  };

  return (
    <button
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} />}
      {children}
    </button>
  );
}
