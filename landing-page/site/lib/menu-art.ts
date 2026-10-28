export type MenuArtKind = "water" | "soda" | "juice" | "shake" | "icecream" | "cake" | "sweets" | "sandwich" | "burger" | "salad" | "eggs" | "chicken" | "beef" | "rice" | "pasta";

export function menuArtKind(name: string, category = ""): MenuArtKind {
  const x = (name + " " + category).replace(/[أإآ]/g, "ا").replace(/[َُِّْ]/g, "").toLowerCase();
  if (/مياه|ماء/.test(x)) return "water";
  if (/صودا|(^| )كولا( |$)/.test(x)) return "soda";
  if (/مشروب بروتين|بروتين شيك/.test(x)) return "shake";
  if (/عصير|ايس تي|بنش|بيري|كلاسيك جرين/.test(x)) return "juice";
  if (/ايس كريم|آيس كريم/.test(x)) return "icecream";
  if (/كرات الحلى|كرات حلى|بسبوس|حلويات/.test(x)) return "sweets";
  if (/كيك|براوني|بروتين بار|تورت/.test(x)) return "cake";
  if (/برجر/.test(x)) return "burger";
  if (/ساندويتش|سندوتش|ساندويش|ساور دو|فاهيتا/.test(x) || category === "الساندويتشات") return "sandwich";
  if (/سلط|شمندر|جرجير/.test(x)) return "salad";
  if (/بيض/.test(x)) return "eggs";
  if (/بطاطس باللحمة|كبسة|كفتة داوود/.test(x)) return "rice";
  if (/مكرونة|باستا/.test(x)) return "pasta";
  if (/لحم/.test(x)) return "beef";
  if (/دجاج/.test(x)) return "chicken";
  return "rice";
}

export function menuArtTone(name: string): string {
  const x = name.replace(/[أإآ]/g, "ا");
  if (/بطيخ|بينت بنش|فراولة/.test(x)) return "pink";
  if (/بيري|توت|شوكلاته|شوكولاته|كرات الحلى/.test(x)) return "berry";
  if (/كلاسيك جرين|نعناع|جرجير|خضراء|شمندر/.test(x)) return "green";
  if (/برتقال|جزر|مانجو|كبسة/.test(x)) return "orange";
  if (/فانيليا|بيض|حليب|مياه|ماء/.test(x)) return "cream";
  return "natural";
}

export function menuArtUrl(name: string, category = "") {
  return "/api/menu-art?kind=" + menuArtKind(name, category) + "&tone=" + menuArtTone(name);
}
