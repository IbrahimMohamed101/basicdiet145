import { Badge } from "./ui/badge";

type StatusType =
  // Subscription statuses
  | "pending_payment"
  | "active"
  | "expired"
  | "canceled"
  // Day statuses
  | "open"
  | "frozen"
  | "locked"
  | "in_preparation"
  | "out_for_delivery"
  | "ready_for_pickup"
  | "fulfilled"
  | "skipped"
  // Payment statuses
  | "initiated"
  | "paid"
  | "failed"
  | "refunded"
  // Order statuses
  | "created"
  | "confirmed"
  | "preparing"
  | "delivered"
  | "pending";

const statusConfig: Record<StatusType, { ar: string; color: string }> = {
  // Subscription
  pending_payment: { ar: "في انتظار الدفع", color: "bg-[#6C757D]" },
  active: { ar: "نشط", color: "bg-[#2D6A4F]" },
  expired: { ar: "منتهي", color: "bg-[#F4A261]" },
  canceled: { ar: "ملغي", color: "bg-[#E63946]" },
  
  // Day Status
  open: { ar: "مفتوح", color: "bg-[#4361EE]" },
  frozen: { ar: "مجمد", color: "bg-[#87CEEB]" },
  locked: { ar: "مقفل", color: "bg-[#F4A261]" },
  in_preparation: { ar: "قيد التحضير", color: "bg-[#F4A261]" },
  out_for_delivery: { ar: "في الطريق", color: "bg-[#9B59B6]" },
  ready_for_pickup: { ar: "جاهز للاستلام", color: "bg-[#20B2AA]" },
  fulfilled: { ar: "مكتمل", color: "bg-[#2D6A4F]" },
  skipped: { ar: "متخطى", color: "bg-[#6C757D]" },
  
  // Payment
  initiated: { ar: "بدأ", color: "bg-[#6C757D]" },
  paid: { ar: "مدفوع", color: "bg-[#2D6A4F]" },
  failed: { ar: "فشل", color: "bg-[#E63946]" },
  refunded: { ar: "مسترد", color: "bg-[#4361EE]" },
  
  // Order
  created: { ar: "تم الإنشاء", color: "bg-[#6C757D]" },
  confirmed: { ar: "مؤكد", color: "bg-[#4361EE]" },
  preparing: { ar: "قيد التحضير", color: "bg-[#F4A261]" },
  delivered: { ar: "تم التوصيل", color: "bg-[#2D6A4F]" },
  pending: { ar: "قيد الانتظار", color: "bg-[#F4A261]" },
};

interface StatusBadgeProps {
  status: StatusType;
  className?: string;
}

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const config = statusConfig[status];
  
  if (!config) {
    return null;
  }

  return (
    <Badge
      className={`${config.color} hover:${config.color} text-white ${className}`}
      style={{ fontFamily: 'Cairo, sans-serif' }}
    >
      {config.ar}
    </Badge>
  );
}
