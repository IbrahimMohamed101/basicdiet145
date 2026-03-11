import { useState } from "react";
import { Plus, Edit, Power } from "lucide-react";
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
import { Switch } from "../components/ui/switch";

interface Ingredient {
  id: number;
  nameAr: string;
  nameEn: string;
  price: number;
  calories?: number;
  maxQuantity?: number;
  isActive: boolean;
}

const mockIngredients: Ingredient[] = [
  {
    id: 1,
    nameAr: "طماطم",
    nameEn: "Tomato",
    price: 500,
    calories: 18,
    maxQuantity: 5,
    isActive: true,
  },
  {
    id: 2,
    nameAr: "خيار",
    nameEn: "Cucumber",
    price: 400,
    calories: 16,
    maxQuantity: 5,
    isActive: true,
  },
  {
    id: 3,
    nameAr: "خس",
    nameEn: "Lettuce",
    price: 300,
    calories: 5,
    maxQuantity: 3,
    isActive: true,
  },
  {
    id: 4,
    nameAr: "جرجير",
    nameEn: "Arugula",
    price: 600,
    calories: 25,
    maxQuantity: 3,
    isActive: false,
  },
  {
    id: 5,
    nameAr: "فلفل رومي",
    nameEn: "Bell Pepper",
    price: 700,
    calories: 20,
    maxQuantity: 4,
    isActive: true,
  },
];

export function SaladIngredients() {
  const [ingredients, setIngredients] = useState(mockIngredients);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(null);

  const handleEdit = (ingredient: Ingredient) => {
    setEditingIngredient(ingredient);
    setIsDialogOpen(true);
  };

  const handleToggle = (id: number) => {
    setIngredients(
      ingredients.map((ingredient) =>
        ingredient.id === id
          ? { ...ingredient, isActive: !ingredient.isActive }
          : ingredient
      )
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]" style={{ fontFamily: 'Cairo, sans-serif' }}>
            مكونات السلطة
          </h1>
          <p className="text-sm text-[#6C757D]">إدارة المكونات المتاحة للسلطات</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
              <Plus className="w-4 h-4 ml-2" />
              إضافة مكون
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-xl" dir="rtl">
            <DialogHeader>
              <DialogTitle style={{ fontFamily: 'Cairo, sans-serif' }}>
                {editingIngredient ? "تعديل مكون" : "إضافة مكون جديد"}
              </DialogTitle>
            </DialogHeader>
            <AddEditIngredientForm
              ingredient={editingIngredient}
              onClose={() => {
                setIsDialogOpen(false);
                setEditingIngredient(null);
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
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                الاسم بالعربية
              </TableHead>
              <TableHead className="text-right">Name EN</TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                السعر
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                السعرات
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                الحد الأقصى
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                الحالة
              </TableHead>
              <TableHead className="text-right" style={{ fontFamily: 'Cairo, sans-serif' }}>
                إجراءات
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ingredients.map((ingredient) => (
              <TableRow key={ingredient.id}>
                <TableCell className="font-medium" style={{ fontFamily: 'Cairo, sans-serif' }}>
                  {ingredient.nameAr}
                </TableCell>
                <TableCell>{ingredient.nameEn}</TableCell>
                <TableCell>
                  <span className="font-medium">{(ingredient.price / 100).toFixed(2)}</span>
                  <span className="text-xs text-[#6C757D] mr-1">ريال</span>
                </TableCell>
                <TableCell>
                  {ingredient.calories ? (
                    <span className="text-sm">{ingredient.calories} kcal</span>
                  ) : (
                    <span className="text-xs text-[#6C757D]">-</span>
                  )}
                </TableCell>
                <TableCell>
                  {ingredient.maxQuantity ? (
                    <span className="text-sm">{ingredient.maxQuantity}</span>
                  ) : (
                    <span className="text-xs text-[#6C757D]">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={ingredient.isActive ? "default" : "secondary"}
                    className={
                      ingredient.isActive
                        ? "bg-[#2D6A4F] hover:bg-[#2D6A4F]"
                        : "bg-[#6C757D] hover:bg-[#6C757D]"
                    }
                  >
                    {ingredient.isActive ? "نشط" : "غير نشط"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEdit(ingredient)}
                      className="h-8 w-8 text-[#4361EE] hover:text-[#4361EE] hover:bg-[#4361EE]/10"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleToggle(ingredient.id)}
                      className="h-8 w-8 text-[#40916C] hover:text-[#40916C] hover:bg-[#40916C]/10"
                    >
                      <Power className="w-4 h-4" />
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

function AddEditIngredientForm({
  ingredient,
  onClose,
}: {
  ingredient: Ingredient | null;
  onClose: () => void;
}) {
  return (
    <form className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="nameAr" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الاسم بالعربية
          </Label>
          <Input
            id="nameAr"
            defaultValue={ingredient?.nameAr}
            placeholder="أدخل الاسم بالعربية"
            style={{ fontFamily: 'Cairo, sans-serif' }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nameEn">Name EN</Label>
          <Input
            id="nameEn"
            defaultValue={ingredient?.nameEn}
            placeholder="Enter name in English"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="price" style={{ fontFamily: 'Cairo, sans-serif' }}>
            السعر (هللة)
          </Label>
          <Input
            id="price"
            type="number"
            defaultValue={ingredient?.price}
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="calories" style={{ fontFamily: 'Cairo, sans-serif' }}>
            السعرات (اختياري)
          </Label>
          <Input
            id="calories"
            type="number"
            defaultValue={ingredient?.calories}
            placeholder="0"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="maxQuantity" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الحد الأقصى (اختياري)
          </Label>
          <Input
            id="maxQuantity"
            type="number"
            defaultValue={ingredient?.maxQuantity}
            placeholder="0"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="isActive" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الحالة
          </Label>
          <div className="flex items-center gap-3 h-10">
            <Switch id="isActive" defaultChecked={ingredient?.isActive} />
            <span className="text-sm" style={{ fontFamily: 'Cairo, sans-serif' }}>
              {ingredient?.isActive ? "نشط" : "غير نشط"}
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
