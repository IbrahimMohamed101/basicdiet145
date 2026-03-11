import { useState } from "react";
import { Plus, Edit, Trash2, Copy, GripVertical, Power } from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Switch } from "../components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { ImageWithFallback } from "../components/figma/ImageWithFallback";

interface Addon {
  id: number;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  image: string;
  price: number;
  type: "subscription" | "one_time";
  sortOrder: number;
  isActive: boolean;
}

const mockAddons: Addon[] = [
  {
    id: 1,
    nameAr: "بروتين إضافي",
    nameEn: "Extra Protein",
    descriptionAr: "بروتين دجاج مشوي إضافي",
    descriptionEn: "Additional grilled chicken protein",
    image: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=100",
    price: 2500,
    type: "subscription",
    sortOrder: 1,
    isActive: true,
  },
  {
    id: 2,
    nameAr: "أفوكادو",
    nameEn: "Avocado",
    descriptionAr: "شرائح أفوكادو طازجة",
    descriptionEn: "Fresh avocado slices",
    image: "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=100",
    price: 1500,
    type: "one_time",
    sortOrder: 2,
    isActive: true,
  },
  {
    id: 3,
    nameAr: "سموثي البروتين",
    nameEn: "Protein Smoothie",
    descriptionAr: "سموثي بروتين بنكهة الشوكولاتة",
    descriptionEn: "Chocolate flavored protein smoothie",
    image: "https://images.unsplash.com/photo-1610970881699-44a5587cabec?w=100",
    price: 3000,
    type: "one_time",
    sortOrder: 3,
    isActive: false,
  },
];

export function MenuAddons() {
  const [addons, setAddons] = useState(mockAddons);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAddon, setEditingAddon] = useState<Addon | null>(null);

  const handleEdit = (addon: Addon) => {
    setEditingAddon(addon);
    setIsDialogOpen(true);
  };

  const handleToggle = (id: number) => {
    setAddons(
      addons.map((addon) =>
        addon.id === id ? { ...addon, isActive: !addon.isActive } : addon
      )
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("هل أنت متأكد من حذف هذه الإضافة؟")) {
      setAddons(addons.filter((addon) => addon.id !== id));
    }
  };

  const handleClone = (addon: Addon) => {
    const newAddon = {
      ...addon,
      id: Math.max(...addons.map((a) => a.id)) + 1,
      nameAr: addon.nameAr + " (نسخة)",
      nameEn: addon.nameEn + " (Copy)",
    };
    setAddons([...addons, newAddon]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الإضافات
          </h1>
          <p className="text-sm text-[#6C757D]">إدارة الإضافات المتاحة للوجبات</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
              <Plus className="w-4 h-4 ml-2" />
              إضافة منتج
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl" dir="rtl">
            <DialogHeader>
              <DialogTitle style={{ fontFamily: 'Cairo, sans-serif' }}>
                {editingAddon ? "تعديل إضافة" : "إضافة منتج جديد"}
              </DialogTitle>
            </DialogHeader>
            <AddEditAddonForm
              addon={editingAddon}
              onClose={() => {
                setIsDialogOpen(false);
                setEditingAddon(null);
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-[#E9ECEF]">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F8F9FA]">
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>الصورة</TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>الاسم بالعربية</TableHead>
              <TableHead className="text-right">Name EN</TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>السعر</TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>النوع</TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>الحالة</TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>الترتيب</TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {addons.map((addon) => (
              <TableRow key={addon.id}>
                <TableCell>
                  <ImageWithFallback
                    src={addon.image}
                    alt={addon.nameEn}
                    className="w-12 h-12 rounded-lg object-cover"
                  />
                </TableCell>
                <TableCell className="font-medium" style={{ fontFamily: 'Cairo, sans-serif' }}>
                  {addon.nameAr}
                </TableCell>
                <TableCell>{addon.nameEn}</TableCell>
                <TableCell>
                  <span className="font-medium">{(addon.price / 100).toFixed(2)}</span>
                  <span className="text-xs text-[#6C757D] mr-1">ريال</span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={addon.type === "subscription" ? "default" : "secondary"}
                    className={
                      addon.type === "subscription"
                        ? "bg-[#4361EE] hover:bg-[#4361EE]"
                        : "bg-[#F4A261] hover:bg-[#F4A261] text-white"
                    }
                  >
                    {addon.type === "subscription" ? "اشتراك" : "مرة واحدة"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={addon.isActive ? "default" : "secondary"}
                    className={
                      addon.isActive
                        ? "bg-[#2D6A4F] hover:bg-[#2D6A4F]"
                        : "bg-[#6C757D] hover:bg-[#6C757D]"
                    }
                  >
                    {addon.isActive ? "نشط" : "غير نشط"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <GripVertical className="w-4 h-4 text-[#6C757D] cursor-move" />
                    <span className="text-sm">{addon.sortOrder}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(addon)}
                      className="h-8 w-8 text-[#4361EE] hover:text-[#4361EE] hover:bg-[#4361EE]/10"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleToggle(addon.id)}
                      className="h-8 w-8 text-[#40916C] hover:text-[#40916C] hover:bg-[#40916C]/10"
                    >
                      <Power className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleClone(addon)}
                      className="h-8 w-8 text-[#6C757D] hover:text-[#6C757D] hover:bg-[#6C757D]/10"
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(addon.id)}
                      className="h-8 w-8 text-[#E63946] hover:text-[#E63946] hover:bg-[#E63946]/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AddEditAddonForm({ addon, onClose }: { addon: Addon | null; onClose: () => void }) {
  const [priceHalala, setPriceHalala] = useState(addon?.price || 0);

  return (
    <form className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="nameAr" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الاسم بالعربية
          </Label>
          <Input
            id="nameAr"
            defaultValue={addon?.nameAr}
            placeholder="أدخل الاسم بالعربية"
            style={{ fontFamily: 'Cairo, sans-serif' }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nameEn">Name EN</Label>
          <Input id="nameEn" defaultValue={addon?.nameEn} placeholder="Enter name in English" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="descAr" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الوصف بالعربية
          </Label>
          <Textarea
            id="descAr"
            defaultValue={addon?.descriptionAr}
            placeholder="أدخل الوصف بالعربية"
            style={{ fontFamily: 'Cairo, sans-serif' }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="descEn">Description EN</Label>
          <Textarea
            id="descEn"
            defaultValue={addon?.descriptionEn}
            placeholder="Enter description in English"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="image" style={{ fontFamily: 'Cairo, sans-serif' }}>
          رابط الصورة
        </Label>
        <Input id="image" defaultValue={addon?.image} placeholder="https://..." />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="price" style={{ fontFamily: 'Cairo, sans-serif' }}>
            السعر (هللة)
          </Label>
          <div className="relative">
            <Input
              id="price"
              type="number"
              value={priceHalala}
              onChange={(e) => setPriceHalala(Number(e.target.value))}
              placeholder="0"
            />
            <div className="absolute top-2 left-3 text-xs text-[#6C757D]">
              = {(priceHalala / 100).toFixed(2)} ريال
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="type" style={{ fontFamily: 'Cairo, sans-serif' }}>
            النوع
          </Label>
          <Select defaultValue={addon?.type || "subscription"}>
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="subscription" style={{ fontFamily: 'Cairo, sans-serif' }}>
                اشتراك
              </SelectItem>
              <SelectItem value="one_time" style={{ fontFamily: 'Cairo, sans-serif' }}>
                مرة واحدة
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="sortOrder" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الترتيب
          </Label>
          <Input
            id="sortOrder"
            type="number"
            defaultValue={addon?.sortOrder || 1}
            placeholder="1"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="isActive" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الحالة
          </Label>
          <div className="flex items-center gap-3 h-10">
            <Switch id="isActive" defaultChecked={addon?.isActive} />
            <span className="text-sm" style={{ fontFamily: 'Cairo, sans-serif' }}>
              {addon?.isActive ? "نشط" : "غير نشط"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          إلغاء
        </Button>
        <Button type="submit" className="bg-[#1B4332] hover:bg-[#2D6A4F]">
          حفظ
        </Button>
      </div>
    </form>
  );
}
