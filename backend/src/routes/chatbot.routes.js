const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// System prompt specific to VoiceUp
const SYSTEM_PROMPT = `
You are 'ChatUp', the official VoiceUp AI Assistant. 
You answer questions EXCLUSIVELY about the VoiceUp platform. 
If a user asks about anything else, politely redirect them back to VoiceUp features.

VoiceUp Features:
- Report a civic issue (Streetlight, Water, Road, Garbage) by filling the form, uploading a photo, or using Voice Recording.
- Track report status (Submitted, In Progress, Approved, Resolved) in the 'My Reports' section.
- Earn Voice Coins (VC) for reporting verifiable issues.
- Redeem Voice Coins in the 'Rewards Store' for gift vouchers (Amazon, Myntra, etc.).
- 'Nearby Issues' shows reports within a 5km radius.
- AI Priority Classification automatically sets high, medium, or low priority based on photos and report frequency.

Be incredibly helpful, positive, and provide step-by-step guidance.
Respond in the language the user speaks (Hindi, English, or Hinglish).
Keep responses concise, using bullet points where appropriate.
`;

// Fallback offline suggestions
const fallbackSuggestions = [
    { text: '📝 Report kaise kare?', query: 'Report kaise submit karu?' },
    { text: '📊 Track my report', query: 'Meri complaint ka status kaise dekhu?' },
    { text: '🎙️ Voice se report', query: 'Voice se report kaise karu?' },
    { text: '🪙 Voice Coins', query: 'Voice Coins kya hain?' }
];

router.post('/message', async (req, res) => {
    try {
        const { message, history = [] } = req.body;
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const messages = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...history.map(msg => ({ role: msg.role, content: msg.content })),
            { role: 'user', content: message }
        ];

        const completion = await groq.chat.completions.create({
            messages,
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 500,
            top_p: 1
        });

        const reply = completion.choices[0]?.message?.content || "Mujhe khed hai, main samajh nahi paya. Kripya phirse puchein.";
        
        res.json({ reply });

    } catch (error) {
        console.error('Groq API Error:', error);
        res.json({ 
            reply: 'Mujhe abhi thodi technical problem aa rahi hai. Kripya thodi der baad try karein. Ya fir aap mere quick suggestions use kar sakte hain! 🙏'
        });
    }
});

router.get('/suggestions', (req, res) => {
    // We can just return static here or use AI to generate dynamic ones 
    // based on context. For now, returning static.
    res.json({ suggestions: fallbackSuggestions });
});

module.exports = router;
