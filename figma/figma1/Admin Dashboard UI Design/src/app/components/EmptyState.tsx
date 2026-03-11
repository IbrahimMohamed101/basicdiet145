import { LucideIcon } from "lucide-react";
import { Button } from "./ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  titleEn: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  titleEn,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-20 h-20 bg-[#F8F9FA] rounded-full flex items-center justify-center mb-4">
        <Icon className="w-10 h-10 text-[#6C757D]" />
      </div>
      <h3 className="text-lg font-medium text-[#212529] mb-2" style={{ fontFamily: 'Cairo, sans-serif' }}>
        {title}
      </h3>
      <p className="text-sm text-[#6C757D] mb-1">{titleEn}</p>
      {description && (
        <p className="text-sm text-[#6C757D] max-w-md mb-6" style={{ fontFamily: 'Cairo, sans-serif' }}>
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <Button onClick={onAction} className="bg-[#1B4332] hover:bg-[#2D6A4F]">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
