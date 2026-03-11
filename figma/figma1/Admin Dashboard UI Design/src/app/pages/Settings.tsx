import { useState } from "react";
import { Save, AlertTriangle, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Badge } from "../components/ui/badge";
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

export function Settings() {
  const [cutoffTime, setCutoffTime] = useState("18:00");
  const [skipAllowance, setSkipAllowance] = useState("2");
  const [vatPercentage, setVatPercentage] = useState("15");
  const [premiumPrice, setPremiumPrice] = useState("50.00");
  const [deliveryFee, setDeliveryFee] = useState("1000");
  const [saladBasePrice, setSaladBasePrice] = useState("25.00");
  const [deliveryWindows, setDeliveryWindows] = useState([
    "12:00 - 14:00",
    "14:00 - 16:00",
    "16:00 - 18:00",
    "18:00 - 20:00",
  ]);
  const [newWindow, setNewWindow] = useState("");
  const [jobResult, setJobResult] = useState("");

  const handleAddWindow = () => {
    if (newWindow.trim()) {
      setDeliveryWindows([...deliveryWindows, newWindow.trim()]);
      setNewWindow("");
    }
  };

  const handleRemoveWindow = (index: number) => {
    setDeliveryWindows(deliveryWindows.filter((_, i) => i !== index));
  };

  const handleTriggerCutoff = () => {
    setJobResult("تم تشغيل مهمة القطع بنجاح. تمت معالجة 45 اشتراك.");
    setTimeout(() => setJobResult(""), 5000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#212529]" style={{ fontFamily: 'Cairo, sans-serif' }}>
            الإعدادات
          </h1>
          <p className="text-sm text-[#6C757D]">إدارة إعدادات النظام</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6">
        <Tabs defaultValue="general" orientation="vertical" className="flex gap-6 w-full">
          <TabsList className="flex-col h-auto bg-white border border-[#E9ECEF] p-2 w-64">
            <TabsTrigger
              value="general"
              className="w-full justify-start"
              style={{ fontFamily: 'Cairo, sans-serif' }}
            >
              عام
            </TabsTrigger>
            <TabsTrigger
              value="pricing"
              className="w-full justify-start"
              style={{ fontFamily: 'Cairo, sans-serif' }}
            >
              التسعير
            </TabsTrigger>
            <TabsTrigger
              value="delivery"
              className="w-full justify-start"
              style={{ fontFamily: 'Cairo, sans-serif' }}
            >
              أوقات التوصيل
            </TabsTrigger>
            <TabsTrigger
              value="system"
              className="w-full justify-start"
              style={{ fontFamily: 'Cairo, sans-serif' }}
            >
              النظام
            </TabsTrigger>
          </TabsList>

          <div className="flex-1">
            {/* General Tab */}
            <TabsContent value="general" className="mt-0">
              <div className="bg-white rounded-lg border border-[#E9ECEF] p-6 space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-4" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    الإعدادات العامة
                  </h3>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="cutoffTime" style={{ fontFamily: 'Cairo, sans-serif' }}>
                      وقت القطع
                    </Label>
                    <div className="flex gap-3">
                      <Input
                        id="cutoffTime"
                        type="time"
                        value={cutoffTime}
                        onChange={(e) => setCutoffTime(e.target.value)}
                        className="max-w-xs"
                      />
                      <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
                        <Save className="w-4 h-4 ml-2" />
                        حفظ
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="skipAllowance" style={{ fontFamily: 'Cairo, sans-serif' }}>
                      عدد أيام التخطي المسموحة
                    </Label>
                    <div className="flex gap-3">
                      <Input
                        id="skipAllowance"
                        type="number"
                        value={skipAllowance}
                        onChange={(e) => setSkipAllowance(e.target.value)}
                        className="max-w-xs"
                        min="0"
                      />
                      <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
                        <Save className="w-4 h-4 ml-2" />
                        حفظ
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="vat" style={{ fontFamily: 'Cairo, sans-serif' }}>
                      نسبة ضريبة القيمة المضافة (%)
                    </Label>
                    <div className="flex gap-3">
                      <Input
                        id="vat"
                        type="number"
                        value={vatPercentage}
                        onChange={(e) => setVatPercentage(e.target.value)}
                        className="max-w-xs"
                        min="0"
                        max="100"
                      />
                      <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
                        <Save className="w-4 h-4 ml-2" />
                        حفظ
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Pricing Tab */}
            <TabsContent value="pricing" className="mt-0">
              <div className="bg-white rounded-lg border border-[#E9ECEF] p-6 space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-4" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    إعدادات التسعير
                  </h3>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="premiumPrice" style={{ fontFamily: 'Cairo, sans-serif' }}>
                      سعر الوجبة البريميوم (ريال)
                    </Label>
                    <div className="flex gap-3">
                      <Input
                        id="premiumPrice"
                        type="number"
                        value={premiumPrice}
                        onChange={(e) => setPremiumPrice(e.target.value)}
                        className="max-w-xs"
                        step="0.01"
                      />
                      <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
                        <Save className="w-4 h-4 ml-2" />
                        حفظ
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="deliveryFee" style={{ fontFamily: 'Cairo, sans-serif' }}>
                      رسوم التوصيل للاشتراكات (هللة)
                    </Label>
                    <div className="flex gap-3 items-center">
                      <Input
                        id="deliveryFee"
                        type="number"
                        value={deliveryFee}
                        onChange={(e) => setDeliveryFee(e.target.value)}
                        className="max-w-xs"
                      />
                      <span className="text-sm text-[#6C757D]">
                        = {(Number(deliveryFee) / 100).toFixed(2)} ريال
                      </span>
                      <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
                        <Save className="w-4 h-4 ml-2" />
                        حفظ
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="saladBasePrice" style={{ fontFamily: 'Cairo, sans-serif' }}>
                      السعر الأساسي للسلطة المخصصة (ريال)
                    </Label>
                    <div className="flex gap-3">
                      <Input
                        id="saladBasePrice"
                        type="number"
                        value={saladBasePrice}
                        onChange={(e) => setSaladBasePrice(e.target.value)}
                        className="max-w-xs"
                        step="0.01"
                      />
                      <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
                        <Save className="w-4 h-4 ml-2" />
                        حفظ
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Delivery Windows Tab */}
            <TabsContent value="delivery" className="mt-0">
              <div className="bg-white rounded-lg border border-[#E9ECEF] p-6 space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-4" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    أوقات التوصيل
                  </h3>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {deliveryWindows.map((window, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="text-sm py-2 px-4 bg-[#F8F9FA] text-[#212529] hover:bg-[#E9ECEF]"
                      >
                        {window}
                        <button
                          onClick={() => handleRemoveWindow(index)}
                          className="mr-2 hover:text-[#E63946]"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="newWindow" style={{ fontFamily: 'Cairo, sans-serif' }}>
                      إضافة وقت توصيل جديد
                    </Label>
                    <div className="flex gap-3">
                      <Input
                        id="newWindow"
                        value={newWindow}
                        onChange={(e) => setNewWindow(e.target.value)}
                        placeholder="مثال: 20:00 - 22:00"
                        className="max-w-xs"
                      />
                      <Button
                        onClick={handleAddWindow}
                        className="bg-[#40916C] hover:bg-[#40916C]/90"
                      >
                        إضافة
                      </Button>
                    </div>
                  </div>

                  <div className="pt-4">
                    <Button className="bg-[#1B4332] hover:bg-[#2D6A4F]">
                      <Save className="w-4 h-4 ml-2" />
                      حفظ الكل
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* System Tab */}
            <TabsContent value="system" className="mt-0">
              <div className="bg-white rounded-lg border border-[#E9ECEF] p-6 space-y-6">
                <div>
                  <h3 className="text-lg font-medium mb-4" style={{ fontFamily: 'Cairo, sans-serif' }}>
                    إعدادات النظام
                  </h3>
                </div>

                <div className="space-y-4">
                  <div className="p-4 bg-[#FFF3CD] border border-[#F4A261] rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-[#F4A261] mt-0.5" />
                      <div>
                        <p className="font-medium text-[#856404]" style={{ fontFamily: 'Cairo, sans-serif' }}>
                          تحذير
                        </p>
                        <p className="text-sm text-[#856404]" style={{ fontFamily: 'Cairo, sans-serif' }}>
                          هذا الإجراء سيقوم بتشغيل مهمة القطع يدوياً. يرجى التأكد من أنك تريد المتابعة.
                        </p>
                      </div>
                    </div>
                  </div>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        className="bg-[#E63946] hover:bg-[#E63946]/90"
                      >
                        <AlertTriangle className="w-4 h-4 ml-2" />
                        تشغيل مهمة القطع
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent dir="rtl">
                      <AlertDialogHeader>
                        <AlertDialogTitle style={{ fontFamily: 'Cairo, sans-serif' }}>
                          تأكيد تشغيل المهمة
                        </AlertDialogTitle>
                        <AlertDialogDescription style={{ fontFamily: 'Cairo, sans-serif' }}>
                          هل أنت متأكد من تشغيل مهمة القطع؟ سيتم قفل جميع الاشتراكات النشطة حسب
                          وقت القطع المحدد.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>إلغاء</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleTriggerCutoff}
                          className="bg-[#E63946] hover:bg-[#E63946]/90"
                        >
                          تأكيد
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  {jobResult && (
                    <div className="p-4 bg-[#D1F2EB] border border-[#2D6A4F] rounded-lg">
                      <p className="text-sm text-[#0F5132]" style={{ fontFamily: 'Cairo, sans-serif' }}>
                        {jobResult}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
