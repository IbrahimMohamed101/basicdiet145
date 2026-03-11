import { useState } from "react";
import { useParams, Link } from "react-router";
import {
  ArrowRight,
  Save,
  Plus,
  GripVertical,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Copy,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import { toast } from "sonner";

type MealOption = {
  id: string;
  mealsPerDay: number;
  price: number;
  comparePrice: number;
  active: boolean;
  sortOrder: number;
};

type GramsOption = {
  id: string;
  grams: number;
  active: boolean;
  sortOrder: number;
  mealOptions: MealOption[];
};

export function PlanDetails() {
  const { id } = useParams();
  const isNew = id === "new";

  const [formData, setFormData] = useState({
    nameAr: "باقة شهرية مميزة",
    nameEn: "Premium Monthly",
    daysCount: 30,
    sortOrder: 1,
    currency: "SAR",
    skipAllowanceCompensatedDays: 3,
    freezePolicyEnabled: true,
    freezeMaxDays: 5,
    freezeMaxTimes: 2,
    isActive: true,
  });

  const [gramsOptions, setGramsOptions] = useState<GramsOption[]>([
    {
      id: "1",
      grams: 300,
      active: true,
      sortOrder: 1,
      mealOptions: [
        {
          id: "1-1",
          mealsPerDay: 1,
          price: 400,
          comparePrice: 500,
          active: true,
          sortOrder: 1,
        },
        {
          id: "1-2",
          mealsPerDay: 2,
          price: 700,
          comparePrice: 900,
          active: true,
          sortOrder: 2,
        },
      ],
    },
    {
      id: "2",
      grams: 400,
      active: true,
      sortOrder: 2,
      mealOptions: [
        {
          id: "2-1",
          mealsPerDay: 1,
          price: 500,
          comparePrice: 600,
          active: true,
          sortOrder: 1,
        },
        {
          id: "2-2",
          mealsPerDay: 2,
          price: 900,
          comparePrice: 1100,
          active: true,
          sortOrder: 2,
        },
        {
          id: "2-3",
          mealsPerDay: 3,
          price: 1200,
          comparePrice: 1500,
          active: false,
          sortOrder: 3,
        },
      ],
    },
    {
      id: "3",
      grams: 500,
      active: false,
      sortOrder: 3,
      mealOptions: [
        {
          id: "3-1",
          mealsPerDay: 1,
          price: 600,
          comparePrice: 700,
          active: true,
          sortOrder: 1,
        },
      ],
    },
  ]);

  const handleSave = () => {
    toast.success(isNew ? "تم إنشاء الباقة بنجاح" : "تم حفظ التغييرات بنجاح");
  };

  const addGramsOption = () => {
    const newId = String(gramsOptions.length + 1);
    setGramsOptions([
      ...gramsOptions,
      {
        id: newId,
        grams: 350,
        active: true,
        sortOrder: gramsOptions.length + 1,
        mealOptions: [],
      },
    ]);
    toast.success("تم إضافة خيار جرام جديد");
  };

  const deleteGramsOption = (id: string) => {
    setGramsOptions(gramsOptions.filter((g) => g.id !== id));
    toast.success("تم حذف خيار الجرام");
  };

  const cloneGramsOption = (id: string) => {
    const option = gramsOptions.find((g) => g.id === id);
    if (option) {
      const newId = String(gramsOptions.length + 1);
      setGramsOptions([
        ...gramsOptions,
        { ...option, id: newId, sortOrder: gramsOptions.length + 1 },
      ]);
      toast.success("تم نسخ خيار الجرام");
    }
  };

  const toggleGramsOption = (id: string) => {
    setGramsOptions(
      gramsOptions.map((g) => (g.id === id ? { ...g, active: !g.active } : g))
    );
  };

  const addMealOption = (gramsId: string) => {
    setGramsOptions(
      gramsOptions.map((g) => {
        if (g.id === gramsId) {
          const newMealId = `${gramsId}-${g.mealOptions.length + 1}`;
          return {
            ...g,
            mealOptions: [
              ...g.mealOptions,
              {
                id: newMealId,
                mealsPerDay: 1,
                price: 0,
                comparePrice: 0,
                active: true,
                sortOrder: g.mealOptions.length + 1,
              },
            ],
          };
        }
        return g;
      })
    );
    toast.success("تم إضافة خيار وجبة جديد");
  };

  const deleteMealOption = (gramsId: string, mealId: string) => {
    setGramsOptions(
      gramsOptions.map((g) => {
        if (g.id === gramsId) {
          return {
            ...g,
            mealOptions: g.mealOptions.filter((m) => m.id !== mealId),
          };
        }
        return g;
      })
    );
    toast.success("تم حذف خيار الوجبة");
  };

  const cloneMealOption = (gramsId: string, mealId: string) => {
    setGramsOptions(
      gramsOptions.map((g) => {
        if (g.id === gramsId) {
          const meal = g.mealOptions.find((m) => m.id === mealId);
          if (meal) {
            const newMealId = `${gramsId}-${g.mealOptions.length + 1}`;
            return {
              ...g,
              mealOptions: [
                ...g.mealOptions,
                { ...meal, id: newMealId, sortOrder: g.mealOptions.length + 1 },
              ],
            };
          }
        }
        return g;
      })
    );
    toast.success("تم نسخ خيار الوجبة");
  };

  const toggleMealOption = (gramsId: string, mealId: string) => {
    setGramsOptions(
      gramsOptions.map((g) => {
        if (g.id === gramsId) {
          return {
            ...g,
            mealOptions: g.mealOptions.map((m) =>
              m.id === mealId ? { ...m, active: !m.active } : m
            ),
          };
        }
        return g;
      })
    );
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#6C757D]">
        <Link to="/plans" className="hover:text-[#1B4332]">
          الباقات
        </Link>
        <span>/</span>
        <span className="text-[#212529]">
          {isNew ? "إنشاء باقة جديدة" : "تعديل الباقة"}
        </span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/plans">
            <Button variant="ghost" size="icon">
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#212529]">
              {isNew ? "إنشاء باقة جديدة" : "تعديل الباقة"}
            </h1>
            <p className="text-[#6C757D] mt-1">
              {isNew ? "أدخل معلومات الباقة الجديدة" : formData.nameAr}
            </p>
          </div>
        </div>
        <Button onClick={handleSave} className="bg-[#1B4332] hover:bg-[#2D6A4F]">
          <Save className="ml-2 w-4 h-4" />
          حفظ
        </Button>
      </div>

      {/* Plan Form */}
      <Card>
        <CardHeader>
          <CardTitle>معلومات الباقة الأساسية</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="nameAr">الاسم بالعربي</Label>
              <Input
                id="nameAr"
                value={formData.nameAr}
                onChange={(e) =>
                  setFormData({ ...formData, nameAr: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nameEn" className="ltr">Name (EN)</Label>
              <Input
                id="nameEn"
                value={formData.nameEn}
                onChange={(e) =>
                  setFormData({ ...formData, nameEn: e.target.value })
                }
                className="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="daysCount" className="ltr">Days Count</Label>
              <Input
                id="daysCount"
                type="number"
                value={formData.daysCount}
                onChange={(e) =>
                  setFormData({ ...formData, daysCount: Number(e.target.value) })
                }
                className="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sortOrder" className="ltr">Sort Order</Label>
              <Input
                id="sortOrder"
                type="number"
                value={formData.sortOrder}
                onChange={(e) =>
                  setFormData({ ...formData, sortOrder: Number(e.target.value) })
                }
                className="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency" className="ltr">Currency</Label>
              <Input
                id="currency"
                value={formData.currency}
                disabled
                className="ltr bg-[#F8F9FA]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skipAllowance" className="ltr">
                Skip Allowance Compensated Days
              </Label>
              <Input
                id="skipAllowance"
                type="number"
                value={formData.skipAllowanceCompensatedDays}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    skipAllowanceCompensatedDays: Number(e.target.value),
                  })
                }
                className="ltr"
              />
            </div>
          </div>

          <div className="space-y-4 border-t pt-6">
            <div className="flex items-center justify-between">
              <div>
                <Label className="ltr">Freeze Policy</Label>
                <p className="text-sm text-[#6C757D] mt-1">
                  السماح للمستخدمين بتجميد الاشتراك
                </p>
              </div>
              <Switch
                checked={formData.freezePolicyEnabled}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, freezePolicyEnabled: checked })
                }
              />
            </div>

            {formData.freezePolicyEnabled && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="freezeMaxDays" className="ltr">
                    Freeze Max Days
                  </Label>
                  <Input
                    id="freezeMaxDays"
                    type="number"
                    value={formData.freezeMaxDays}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        freezeMaxDays: Number(e.target.value),
                      })
                    }
                    className="ltr"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="freezeMaxTimes" className="ltr">
                    Freeze Max Times
                  </Label>
                  <Input
                    id="freezeMaxTimes"
                    type="number"
                    value={formData.freezeMaxTimes}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        freezeMaxTimes: Number(e.target.value),
                      })
                    }
                    className="ltr"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t pt-6">
            <div>
              <Label className="ltr">Is Active</Label>
              <p className="text-sm text-[#6C757D] mt-1">
                تفعيل أو تعطيل الباقة للمستخدمين
              </p>
            </div>
            <Switch
              checked={formData.isActive}
              onCheckedChange={(checked) =>
                setFormData({ ...formData, isActive: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Grams Options */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-[#212529]">خيارات الجرام</h2>
          <Button
            onClick={addGramsOption}
            variant="outline"
            className="border-[#1B4332] text-[#1B4332] hover:bg-[#1B4332] hover:text-white"
          >
            <Plus className="ml-2 w-4 h-4" />
            إضافة خيار جرام
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {gramsOptions.map((gramsOption) => (
            <Card key={gramsOption.id} className="border-2">
              <CardHeader className="bg-[#F8F9FA]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="cursor-move hover:bg-white"
                    >
                      <GripVertical className="w-4 h-4 text-[#6C757D]" />
                    </Button>
                    <div>
                      <CardTitle className="ltr">
                        {gramsOption.grams}g Option
                      </CardTitle>
                      <p className="text-sm text-[#6C757D] mt-1">
                        ترتيب: {gramsOption.sortOrder}
                      </p>
                    </div>
                    <Badge variant={gramsOption.active ? "default" : "secondary"}>
                      {gramsOption.active ? "نشط" : "غير نشط"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleGramsOption(gramsOption.id)}
                    >
                      {gramsOption.active ? (
                        <ToggleRight className="w-4 h-4" />
                      ) : (
                        <ToggleLeft className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => cloneGramsOption(gramsOption.id)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-[#E63946] hover:text-[#E63946]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="rtl">
                        <AlertDialogHeader>
                          <AlertDialogTitle>حذف خيار الجرام</AlertDialogTitle>
                          <AlertDialogDescription>
                            هل أنت متأكد من حذف خيار {gramsOption.grams}g وجميع خيارات
                            الوجبات المرتبطة به؟
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>إلغاء</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteGramsOption(gramsOption.id)}
                            className="bg-[#E63946] hover:bg-[#D62839]"
                          >
                            حذف
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {/* Meals Options Table */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">خيارات الوجبات</h3>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => addMealOption(gramsOption.id)}
                    >
                      <Plus className="ml-2 w-3 h-3" />
                      إضافة خيار وجبة
                    </Button>
                  </div>

                  {gramsOption.mealOptions.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12"></TableHead>
                          <TableHead className="text-right ltr">Meals/Day</TableHead>
                          <TableHead className="text-right ltr">Price (SAR)</TableHead>
                          <TableHead className="text-right ltr">
                            Compare Price
                          </TableHead>
                          <TableHead className="text-right">الحالة</TableHead>
                          <TableHead className="text-right ltr">Sort</TableHead>
                          <TableHead className="text-right">الإجراءات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gramsOption.mealOptions.map((meal) => (
                          <TableRow key={meal.id}>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="cursor-move hover:bg-[#E9ECEF] h-8 w-8"
                              >
                                <GripVertical className="w-3 h-3 text-[#6C757D]" />
                              </Button>
                            </TableCell>
                            <TableCell className="ltr">{meal.mealsPerDay}</TableCell>
                            <TableCell className="ltr">{meal.price}</TableCell>
                            <TableCell className="ltr">{meal.comparePrice}</TableCell>
                            <TableCell>
                              <Badge
                                variant={meal.active ? "default" : "secondary"}
                                className="text-xs"
                              >
                                {meal.active ? "نشط" : "غير نشط"}
                              </Badge>
                            </TableCell>
                            <TableCell className="ltr">{meal.sortOrder}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    toggleMealOption(gramsOption.id, meal.id)
                                  }
                                  className="h-8 px-2"
                                >
                                  {meal.active ? (
                                    <ToggleRight className="w-3 h-3" />
                                  ) : (
                                    <ToggleLeft className="w-3 h-3" />
                                  )}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    cloneMealOption(gramsOption.id, meal.id)
                                  }
                                  className="h-8 px-2"
                                >
                                  <Copy className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    deleteMealOption(gramsOption.id, meal.id)
                                  }
                                  className="text-[#E63946] hover:text-[#E63946] h-8 px-2"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-center py-8 text-[#6C757D] bg-[#F8F9FA] rounded-lg">
                      لا توجد خيارات وجبات. انقر "إضافة خيار وجبة" للبدء
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {gramsOptions.length === 0 && (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-[#6C757D]">
                <p className="mb-4">لا توجد خيارات جرام لهذه الباقة</p>
                <Button
                  onClick={addGramsOption}
                  className="bg-[#1B4332] hover:bg-[#2D6A4F]"
                >
                  <Plus className="ml-2 w-4 h-4" />
                  إضافة خيار جرام
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
