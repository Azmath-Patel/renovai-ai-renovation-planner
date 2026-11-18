import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the private API key from server/.env
dotenv.config({ path: path.join(__dirname, '.env') });

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is missing from server/.env');
}

const app = express();
const PORT = 3001;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.use(cors({
  origin: 'http://localhost:5173',
}));

app.use(express.json({ limit: '1mb' }));

// Check whether the backend is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'RenovAI backend is running' });
});

// Test the Gemini connection
app.get('/api/test-gemini', async (req, res) => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: 'Reply with exactly: RenovAI Gemini connection successful',
    });

    res.json({
      success: true,
      message: response.text,
    });
  } catch (error) {
    console.error('Gemini error:', error);

    res.status(500).json({
      success: false,
      message: error.message || 'Gemini request failed',
    });
  }
});

// Generate an AI renovation plan
app.post('/api/generate-plan', async (req, res) => {
  try {
    const { project } = req.body;

    if (
      !project ||
      !project.name ||
      !project.city ||
      !project.budget_inr ||
      !project.target_completion_date
    ) {
      return res.status(400).json({
        success: false,
        message: 'Required project information is missing.',
      });
    }

    const prompt = `
You are RenovAI, an expert home renovation planning assistant
specializing in residential renovations in India.

Create a practical renovation plan using this project information:

Project: ${project.name}
City: ${project.city}
Property type: ${project.property_type}
Rooms: ${(project.rooms || []).join(', ')}
Renovation scope: ${project.renovation_scope}
Total budget: INR ${project.budget_inr}
Start date: ${project.start_date}
Target completion date: ${project.target_completion_date}

Return ONLY valid JSON in this structure:

{
  "summary": "Short overview of the renovation plan",
  "phases": [
    {
      "phase_order": 1,
      "title": "Phase name",
      "description": "What happens in this phase",
      "estimated_cost_inr": 100000,
      "duration_days": 10,
      "milestone": "Expected milestone",
      "tasks": [
        {
          "task_key": "task_1",
          "title": "Task name",
          "description": "What needs to be done",
          "estimated_cost_inr": 25000,
          "duration_days": 3,
          "is_milestone": false,
          "depends_on": []
        }
      ]
    }
  ],
  "assumptions": [
    "Assumption about the project"
  ],
  "risks": [
    {
      "title": "Risk name",
      "description": "Why this risk matters",
      "mitigation": "How to reduce the risk"
    }
  ]
}

Rules:
- Use realistic Indian renovation cost estimates in INR.
- Include practical phases such as planning, demolition (if needed),
  civil work, electrical, plumbing, carpentry, painting and finishing
  only when relevant to the project.
- Each task_key must be unique.
- depends_on must contain task_key values of prerequisite tasks.
- Do not create circular dependencies.
- Phase estimated_cost_inr must equal the sum of its task estimates.
- Keep the total estimated cost within the project budget where practical.
- If the budget is insufficient, explain this in assumptions and risks.
- Do not invent exact contractor quotations or guarantee completion dates.
- Keep the plan appropriate for the property type and renovation scope.
- Return JSON only, without Markdown fences.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const plan = JSON.parse(response.text);

    if (!Array.isArray(plan.phases) || plan.phases.length === 0) {
      throw new Error('The AI returned an invalid renovation plan.');
    }

    res.json({
      success: true,
      plan,
    });

  } catch (error) {
    console.error('Plan generation error:', error);

    res.status(500).json({
      success: false,
      message: 'Could not generate the renovation plan. Please try again.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`RenovAI backend running at http://localhost:${PORT}`);
});