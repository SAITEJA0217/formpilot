# FormPilot Product Requirements Document (PRD)

## Product Vision
FormPilot is an AI-powered Chrome Extension and Web Dashboard that helps users fill Google Forms automatically.
Users create their profile once.
When they open a Google Form, FormPilot analyzes the form, matches questions with stored profile data, uses AI to generate answers, and presents a review panel before autofilling.

## MVP Scope
- Support **only** Google Forms.
- Do NOT build: Billing, Payments, Admin Dashboard, Teams, Analytics, Microsoft Forms, Typeform, Jotform, Multi-user organizations.

## Core Features
1. **User Authentication**: Firebase Auth (Email/Google).
2. **Onboarding Flow**: Step-by-step profile creation (Personal, Education, Skills, Projects, Experience, Social Links).
3. **Web Dashboard**: Profile Management, Form History.
4. **Chrome Extension**: Extract Google Form questions, inject Review Panel, and execute autofill.
5. **AI Answer Generation**: Next.js API Route safely calls Gemini 2.5 Flash to map profiles to form questions.
