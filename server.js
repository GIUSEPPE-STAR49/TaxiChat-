const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const translate = require('google-translate-api-x');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Fallback per gestire direttamente il client
app.get('/chat/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// Store room states
const rooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Driver joins a room
    socket.on('join_driver', () => {
        // Genera un ID stanza corto e univoco (6 caratteri alfanumerici)
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        socket.join(roomId);
        rooms[roomId] = { driver: socket.id, clientLang: 'en' };
        socket.emit('room_created', roomId);
    });

    // Client joins a room
    socket.on('join_client', ({ roomId, lang }) => {
        const id = roomId.toUpperCase();
        if (rooms[id]) {
            socket.join(id);
            rooms[id].client = socket.id;
            rooms[id].clientLang = lang || 'en';
            
            // Avvisa il driver che il cliente è entrato
            io.to(rooms[id].driver).emit('client_joined', { lang });
            socket.emit('joined_success');
        } else {
            socket.emit('error', 'Chat inesistente o terminata.');
        }
    });

    // Handle reconnections when browser goes to background and comes back
    socket.on('rejoin_room', ({ roomId, role }) => {
        const id = roomId ? roomId.toUpperCase() : null;
        if (id && rooms[id]) {
            socket.join(id);
            if (role === 'driver') rooms[id].driver = socket.id;
            if (role === 'client') rooms[id].client = socket.id;
        }
    });

    // Handle messages
    socket.on('send_message', async ({ roomId, text, role }) => {
        const id = roomId.toUpperCase();
        const room = rooms[id];
        if (!room) return;

        try {
            if (role === 'driver') {
                // Il tassista scrive in italiano -> Traduciamo nella lingua del cliente -> Inviamo a tutti
                let translatedText = text;
                const targetLang = room.clientLang.split('-')[0]; // Es. en-US -> en
                
                if(targetLang !== 'it') {
                    const res = await translate(text, { from: 'it', to: targetLang });
                    translatedText = res.text;
                }
                
                io.to(id).emit('receive_message', {
                    original: text,
                    translated: translatedText,
                    sender: 'driver'
                });

            } else if (role === 'client') {
                // Il cliente scrive nella sua lingua -> Traduciamo in italiano -> Inviamo a tutti
                let translatedText = text;
                const sourceLang = room.clientLang.split('-')[0];
                
                if(sourceLang !== 'it') {
                    const res = await translate(text, { from: sourceLang, to: 'it' });
                    translatedText = res.text;
                }

                io.to(id).emit('receive_message', {
                    original: text,
                    translated: translatedText,
                    sender: 'client'
                });
            }
        } catch (error) {
            console.error('Translation Error:', error);
            // In caso di errore API, inviamo almeno il testo originale
            io.to(id).emit('receive_message', {
                original: text,
                translated: "[Errore Traduzione] " + text,
                sender: role
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Volendo si può pulire la room se il driver si disconnette
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 TaxiChat server running on http://localhost:${PORT}`);
});
