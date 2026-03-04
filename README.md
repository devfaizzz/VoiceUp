# VoiceUp

AI-powered Civic Issue Tracker enabling citizens to report problems like potholes, garbage overflow, and streetlight faults through a Progressive Web App (PWA), with an admin dashboard for municipal authorities.

The system provides real-time issue tracking, automated routing to departments, analytics dashboards, image uploads, and AI-assisted issue classification.

## Tech Stack

- Frontend: HTML, Tailwind CSS, JavaScript (PWA-ready), Leaflet, Chart.js
- Backend: Node.js, Express.js, Socket.io
- Database: MongoDB (Mongoose)
- Cloud Storage: Cloudinary / AWS S3 (for images and media)
- APIs: REST APIs
- AI Integration: Issue classification using AI services

## Monorepo Structure

backend/
  src/
    ai/
    config/
    controllers/
    middleware/
    models/
    routes/
    services/
    utils/
    server.js

frontend/
  citizen-panel/
  admin-panel/

shared/
  (types, constants)

## Key Features

- Citizen issue reporting with image uploads
- Real-time issue tracking
- Admin dashboard for authorities
- Automated department routing
- AI-assisted issue classification
- Analytics and reporting dashboard
- PWA support for mobile usage

## Getting Started

### Prerequisites

- Node.js >= 18
- npm >= 9
- MongoDB

### Backend Setup
