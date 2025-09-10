# Cocopan Actionable Insights Dashboard
A full-stack web application designed to provide data-driven marketing insights for the bakery brand, Cocopan. This dashboard transforms raw sales data into an interactive tool for customer segmentation, strategic planning, and real-time social sentiment analysis.

## Key Features
- RFM Customer Segmentation: Automatically processes uploaded CSV sales data to segment customers into actionable categories like "Champions," "Loyal Customers," and "At-Risk" based on Recency, Frequency, and Monetary (RFM) analysis.
- Interactive Data Visualization: Features dynamic charts and sortable tables that allow users to explore customer segments and understand key business metrics like average spend and total customers.
- Live Social Sentiment Analysis: Integrates directly with the Facebook Graph API to fetch and analyze the sentiment of real-time comments from a designated business page, providing an up-to-the-minute view of brand perception.
- AI-Powered Strategic Recommendations: Utilizes the Google Gemini API to generate dynamic, data-driven marketing strategies. The application sends current customer segment data to the AI, which returns tailored recommendations for retention and growth.
- Secure Authentication & History: Includes a secure login system and allows users to save and compare different analysis sessions over time.

## Technology Stack
- Frontend: HTML, TailwindCSS, Vanilla JavaScript
- Backend: Node.js with Express.js
- Database: SQLite for user and analysis history storage
- APIs & Libraries:
  - Facebook Graph API: For real-time social media data.
  - Google Gemini API: For sentiment analysis and strategic recommendations.
  - Chart.js: For data visualization.
  - PapaParse: For client-side CSV parsing.
  - bcrypt.js: For password hashing.
  - jsonwebtoken: For managing user sessions.

## Setup and Installation
1. Clone the repository:

```
git clone https://github.com/your-username/cocopan-dashboard.git
cd cocopan-dashboard
```

2. Install dependencies:

npm install

3. Configure Environment Variables:

- Create a .env file in the root of the project.

- Add the following keys, replacing the placeholder values with your actual API keys and tokens for generating AI Insights and a Customer Sentiment Analysis Overview (Facebook):

```
JWT_SECRET=your-secret-key
GEMINI_API_KEY=your-gemini-api-key
FACEBOOK_PAGE_ACCESS_TOKEN=your-fb-page-access-token
```

4. Run the server:

`npm start`

5. Open a browser and navigate to http://localhost:3000 from your terminal.

       
