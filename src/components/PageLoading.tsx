import { Loader2 } from "lucide-react";

interface PageLoadingProps {
  message?: string;
}

export default function PageLoading({ message }: PageLoadingProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="relative">
        {/* Outer spinning ring */}
        <div className="absolute inset-0 rounded-full border-4 border-primary-100 animate-ping opacity-75" style={{ animationDuration: '1.5s' }} />
        
        {/* Middle spinning ring */}
        <div className="relative w-16 h-16 rounded-full border-4 border-primary-200 border-t-primary-600 animate-spin" style={{ animationDuration: '1s' }} />
        
        {/* Center icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="text-primary-600 animate-spin" size={28} style={{ animationDuration: '1.2s', animationDirection: 'reverse' }} />
        </div>
      </div>
      
      {message && (
        <p className="mt-6 text-sm text-gray-600 animate-pulse">{message}</p>
      )}
    </div>
  );
}


