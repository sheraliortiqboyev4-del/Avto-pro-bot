# 📝 Bot Matnlari Konfiguratsiyasi

Bu fayl botdagi barcha admin va foydalanuvchi xabarlarini markazlashtirilgan holda boshqarish uchun yaratilgan.

## 📂 Fayl manzili
```
src/config/texts.js
```

## 🎯 Maqsad

Botdagi barcha matnlar va tugmalar bitta joyda to'plangan. Agar admin username, kanal, yoki boshqa matnlarni o'zgartirish kerak bo'lsa, faqat `texts.js` faylini tahrirlash kifoya.

## 🔧 Qanday o'zgartirish kerak?

### 1. Admin ma'lumotlarini o'zgartirish

```javascript
admin: {
    username: '@id_uzzz',      // ← Admin username ni bu yerda o'zgartiring
    channel: '@AvtoBotOfficial' // ← Rasmiy kanal ni bu yerda o'zgartiring
}
```

**Misol:**
```javascript
admin: {
    username: '@yangi_admin',
    channel: '@YangiKanal'
}
```

### 2. Xabar matnlarini o'zgartirish

**Welcome xabari (sessiya bo'lganda):**
```javascript
welcome: {
    withSession: (name) => 
        `👋 Assalomu alaykum, ${name}! \n\n` +
        `🤖 Bu yerda siz xohlagan matnni yozishingiz mumkin...`
}
```

**Payment xabarlari:**
```javascript
payment: {
    pending: (name, adminUsername) => 
        `Sizning xabaringiz...`,
    
    blocked: (adminUsername) => 
        `Blok xabar...`
}
```

### 3. Admin tugmalarini o'zgartirish

```javascript
adminButtons: {
    approve1Month: (chatId) => ({ 
        text: "✅ 1 Oy",  // ← Tugma matnini o'zgartiring
        callback_data: `admin_approve_1month_${chatId}` 
    })
}
```

## 📍 Qayerda ishlatiladi?

Bu fayl quyidagi joylarda import qilingan:

1. **src/handlers/commands.js** - barcha komandalar (/start, /help, /profile)
2. **src/services/userbot.js** - userbot xabarlari
3. **src/utils/helpers.js** - yordam funksiyalari

## ✏️ Misol: Admin username ni o'zgartirish

**AVVAL:**
```javascript
admin: {
    username: '@id_uzzz',
    channel: '@AvtoBotOfficial'
}
```

**KEYIN:**
```javascript
admin: {
    username: '@mening_admin',
    channel: '@MeningKanal'
}
```

Bu o'zgarish **butun botda** avtomatik qo'llaniladi:
- ✅ /start komandasi
- ✅ Bloklangan foydalanuvchi xabarlari
- ✅ Payment so'rovlari
- ✅ Admin bilan bog'lanish tugmasi
- ✅ /help komandasi

## 🚀 O'zgarishlarni qo'llash

1. `src/config/texts.js` faylini oching
2. Kerakli qismini o'zgartiring
3. Faylni saqlang
4. Botni qayta ishga tushiring:
   ```bash
   npm start
   # yoki
   node src/bot.js
   ```

## 📋 Barcha o'zgartirilishi mumkin bo'lgan matnlar:

- ✅ Welcome xabarlari
- ✅ Payment xabarlari
- ✅ Admin notification xabarlari
- ✅ Yordam matni (/help)
- ✅ Xatolik xabarlari
- ✅ Tugma matnlari
- ✅ Admin va kanal ma'lumotlari

## ⚠️ Muhim eslatmalar

1. **Funksiya parametrlari**: Ba'zi matnlar funksiya sifatida yozilgan, chunki ular dinamik ma'lumot oladi (masalan, foydalanuvchi ismi). Ularni o'zgartirishda funksiya strukturasini saqlang.

2. **Callback data**: Tugmalardagi `callback_data` qismini o'zgartirmang, faqat `text` qismini o'zgartiring.

3. **Format**: Emoji va Markdown formatlarni saqlang (masalan: `**bold**`, `\n\n` - yangi qator)

4. **Test qiling**: Har bir o'zgarishdan keyin botni test qilib ko'ring.

## 🤝 Yordam

Agar savollar bo'lsa yoki muammo yuzaga kelsa:
- Faylni oldingi holatiga qaytaring (git reset)
- Yoki dasturchi bilan bog'laning
