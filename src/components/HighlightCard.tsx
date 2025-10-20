import CopyButton from "./CopyButton";
import OverflowText from "./OverflowText";

interface HighlightCardProps {
  title: string;
  icon: React.ReactNode;
  items: string[];
  colorClass: string;
}

export default function HighlightCard({ title, icon, items, colorClass }: HighlightCardProps) {
  return (
    <div className={`bg-gradient-to-br ${colorClass} rounded-lg p-4 border flex space-x-3`}>
      <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center self-center">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-semibold mb-2">{title}</h4>
        <div className="space-y-1.5">
          {items.map((item, idx) => (
            <div key={idx} className="flex items-center space-x-2 bg-white/70 px-2 py-1.5 rounded">
              <OverflowText text={item} className="flex-1 text-xs font-mono" />
              <CopyButton text={item} size={12} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

