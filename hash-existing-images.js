import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

const reportSchema = new mongoose.Schema({}, { strict: false });
const Report = mongoose.model('Report', reportSchema);

async function syncHashes() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to DB');

    const reports = await Report.find({});
    let count = 0;

    for (let report of reports) {
        if (!report.photoHash && report.photoUrl) {
            try {
                // Determine file path
                let filePath = path.join(process.cwd(), 'public', report.photoUrl);
                if (fs.existsSync(filePath)) {
                    const fileBuffer = fs.readFileSync(filePath);
                    const hash = crypto.createHash('md5').update(fileBuffer).digest('hex');
                    report.photoHash = hash;
                    await report.save();
                    count++;
                    console.log(`Updated hash for report #${report.reportId}`);
                }
            } catch (err) {
                console.log('Error hashing:', err.message);
            }
        }
    }

    console.log(`Done! Hashed ${count} images.`);
    mongoose.disconnect();
}

syncHashes();
