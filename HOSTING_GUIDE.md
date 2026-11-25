# Orvexa — ১০০% ফ্রি (বিনা টাকায়) হোস্টিং ও স্থায়ী স্টোরেজ গাইড

Orvexa এখন একই সাথে **Vercel (Free)**, **Netlify (Free)**, এবং **Render (Free)**—তিনটিতেই **বিনা টাকায় ও কোনো ক্রেডিট কার্ড ছাড়াই** চালানো যায়।

---

## ১. গুরুত্বপূর্ণ: Vercel Pro লাগবে না! (কেন Pro দেখায়?)
Vercel-এর ফ্রি (Hobby) প্ল্যানেও **Environment Variables সম্পূর্ণ ফ্রি**।
- ভুল জায়গা (**Pro চায়**): ড্যাশবোর্ডের একদম উপরের **Team Settings → Shared Environment Variables** (এটা টিমের জন্য, তাই Pro চায়)।
- সঠিক জায়গা (**১০০% ফ্রি**): আপনার আপলোড করা **Project-এর ভেতরে ঢুকে → Settings → Environment Variables**-এ গিয়ে একদম ফ্রি-তে `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` ও `SESSION_SECRET` যোগ করতে পারবেন।

---

## ২. একদম ফ্রি ৩টি হোস্টিং অপশন (কোনো কার্ড লাগে না)

### অপশন A: Vercel Free (ব্যক্তিগত প্রজেক্টে)
1. পুরো প্রজেক্ট (যেখানে `api`, `server`, `src`, `vercel.json`, `package.json` সব আছে) GitHub-এ আপলোড করে Vercel-এ **Add New → Project** দিয়ে Import করুন (অথবা আনজিপ ফোল্ডারে `npx vercel --prod`)।
2. প্রজেক্টের **Settings → Environment Variables**-এ গিয়ে যোগ করুন:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `SESSION_SECRET`
   *(আর `VITE_API_BASE_URL` খালি রাখবেন।)*
3. **Deployments → Redeploy** চাপুন। ব্যাস, অ্যাকাউন্ট, অর্ডার ও ছবি চিরস্থায়ী হয়ে যাবে!

### অপশন B: Render Free (কোনো Pro ঝামেলা নেই + রিয়েল-টাইম WebSocket)
1. প্রজেক্টটি GitHub-এ তুলে **Render.com**-এ **New → Blueprint** সিলেক্ট করুন।
2. প্রজেক্টের `render.yaml` ফাইল থেকেই Render স্বয়ংক্রিয়ভাবে `TURSO_DATABASE_URL` ও `TURSO_AUTH_TOKEN` বসানোর বক্স দেখাবে (এবং `SESSION_SECRET` নিজেই বানিয়ে নেবে)।
3. দুইটি কোড পেস্ট করে **Apply** চাপলেই ফ্রি-তে লাইভ হয়ে যাবে (WebSocket চ্যাটসহ)। *(ফ্রি টায়ারে ১৫ মিনিট কেউ না ঢুকলে স্লিপ মোডে যায় এবং আবার ঢুকলে ~৩০ সেকেন্ডে জেগে ওঠে।)*

### অপশন C: Netlify Free (কার্ড ছাড়া ও বিনা Pro ঝামেলায়)
1. GitHub থেকে প্রজেক্টটি **Netlify**-এ Import করুন (`netlify.toml` ও `netlify/functions/api.ts` আগে থেকেই সেট করা আছে)।
2. **Site configuration → Environment variables**-এ `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, ও `SESSION_SECRET` যোগ করে **Trigger deploy** করুন।

---

## ৩. বিনামূল্যে ছবি ও ব্যাকআপ স্টোরেজ (Google Drive + Turso)
- প্রজেক্টে ইতিমধ্যেই **Google Drive ক্লাউড স্টোরেজ** যুক্ত আছে (Profile, Seller Dashboard এবং Admin Panel-এর একদম নিচে)।
- **Sign in with Google** করে ছবি আপলোড করলে তা আপনার Google Drive-এর ফ্রি **১৫ GB** জায়গায় (`Orvexa Marketplace` ফোল্ডারে) সেভ হবে—ফলে ডাটাবেজের ওপর কোনো চাপ পড়বে না।
- লাইভ করার পর আপনার `.vercel.app` / `.netlify.app` / `.onrender.com` ডোমেইনটি **Firebase Console → Authentication → Settings → Authorized domains**-এ যোগ করে নেবেন, যাতে Google Drive বাটন সব জায়গায় কাজ করে।
