const multer = require('multer');

// Храним файл в памяти (RAM), чтобы потом отправить в Supabase
const storage = multer.memoryStorage();

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // Лимит 5MB
});

module.exports = upload;