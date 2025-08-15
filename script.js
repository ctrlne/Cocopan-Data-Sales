document.addEventListener('DOMContentLoaded', () => {
    // --- GLOBAL VARIABLES & INITIAL SETUP ---
    const loginPage = document.getElementById('loginPage');
    const dashboardPage = document.getElementById('dashboardPage');
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');
    const forgotPasswordLink = document.getElementById('forgotPassword');
    const uploadButton = document.getElementById('uploadButton');
    const fileUploadInput = document.getElementById('fileUpload');
    const loadingModal = document.getElementById('loadingModal');
    const loadingText = document.getElementById('loadingText');
    const themeToggleBtn = document.getElementById('theme-toggle');
    const logoutButton = document.getElementById('logoutButton');
    const historySelect = document.getElementById('historySelect');
    const compareButton = document.getElementById('compareButton');
    const clearHistoryButton = document.getElementById('clearHistoryButton');
    
    const settingsButton = document.getElementById('settingsButton');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsButton = document.getElementById('closeSettingsButton');
    const saveSettingsButton = document.getElementById('saveSettingsButton');
    const cancelSettingsButton = document.getElementById('cancelSettingsButton');
    const passwordChangeForm = document.getElementById('passwordChangeForm');

    const locationFilterContainer = document.getElementById('locationFilterContainer');
    const locationFilter = document.getElementById('locationFilter');
    const locationFilterLabel = document.getElementById('locationFilterLabel');

    const aiInsightModal = document.getElementById('aiInsightModal');
    const closeAIModalButton = document.getElementById('closeAIModalButton');
    const aiInsightContent = document.getElementById('aiInsightContent');
    const getRecommendationsAI = document.getElementById('getRecommendationsAI');
    const getGrowthAI = document.getElementById('getGrowthAI');

    let sentimentChart;

    let customerSegmentChart, segmentSpendChart;
    let columnMap = {};
    let currentAnalysis = {}; 
    let fullSegmentData = {}; 
    let settings = {};
    let authToken = null;
    let rawCsvText = '';

    // --- THEME SETUP ---
    if (localStorage.getItem('color-theme') === 'dark' || (!('color-theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
        document.getElementById('theme-toggle-light-icon').classList.remove('hidden');
    } else {
        document.documentElement.classList.remove('dark');
        document.getElementById('theme-toggle-dark-icon').classList.remove('hidden');
    }

    // --- EVENT LISTENERS ---
    loginForm.addEventListener('submit', handleLogin);
    forgotPasswordLink.addEventListener('click', handleForgotPassword);
    logoutButton.addEventListener('click', handleLogout);
    uploadButton.addEventListener('click', () => fileUploadInput.click());
    fileUploadInput.addEventListener('change', handleFileUpload);
    themeToggleBtn.addEventListener('click', toggleTheme);
    compareButton.addEventListener('click', handleCompare);
    clearHistoryButton.addEventListener('click', handleClearHistory);
    historySelect.addEventListener('change', () => {
        compareButton.disabled = historySelect.value === "none";
    });
    locationFilter.addEventListener('change', handleLocationFilterChange);
    settingsButton.addEventListener('click', openSettings);
    closeSettingsButton.addEventListener('click', closeSettings);
    cancelSettingsButton.addEventListener('click', closeSettings);
    saveSettingsButton.addEventListener('click', saveSettings);
    passwordChangeForm.addEventListener('submit', (e) => {
        e.preventDefault();
        alert("Password change requires a dedicated API endpoint.");
    });
    closeAIModalButton.addEventListener('click', () => aiInsightModal.classList.add('hidden'));
    getRecommendationsAI.addEventListener('click', () => getAIInsight('recommendations'));
    getGrowthAI.addEventListener('click', () => getAIInsight('growth'));
    document.getElementById('filterId').addEventListener('input', () => filterTable());
    document.getElementById('filterVisits').addEventListener('input', () => filterTable());
    document.getElementById('filterSpend').addEventListener('input', () => filterTable());
    
    // --- API HELPER ---
    async function fetchAPI(endpoint, options = {}) {
        const defaultHeaders = {};
        
        if (options.body && !options.headers?.['Content-Type']) {
            defaultHeaders['Content-Type'] = 'application/json';
        }

        if (authToken) {
            defaultHeaders['Authorization'] = `Bearer ${authToken}`;
        }
        const config = {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers,
            },
        };
        const response = await fetch(endpoint, config);
        if (response.status === 204 || response.headers.get("content-length") === "0") {
            return; 
        }
        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'An unknown API error occurred.' }));
            throw new Error(error.message);
        }
        return response.json();
    }

    // --- CORE FUNCTIONS ---
    async function handleLogin(event) {
        event.preventDefault();
        loginError.classList.add('hidden');
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        try {
            const data = await fetchAPI('/api/login', {
                method: 'POST',
                body: JSON.stringify({ username, password }),
            });
            authToken = data.accessToken;
            loginPage.classList.add('hidden');
            dashboardPage.classList.remove('hidden');
            await loadSettings();
            initializeDashboard();
            await loadHistory();
        } catch (error) {
            loginError.textContent = error.message;
            loginError.classList.remove('hidden');
        }
    }
    
    async function handleForgotPassword(event) {
        event.preventDefault();
        const username = prompt("Please enter the username to reset the password for (e.g., admin):");
        if (!username) return;

        const newPassword = prompt(`Enter the new password for user "${username}":`);
        if (!newPassword) return;
        
        const confirmPassword = prompt("Please confirm the new password:");
        if (newPassword !== confirmPassword) {
            alert("Passwords do not match. Please try again.");
            return;
        }

        try {
            showLoading(true, "Resetting password...");
            const response = await fetchAPI('/api/reset-password', {
                method: 'POST',
                body: JSON.stringify({ username, newPassword })
            });
            alert(response.message);
        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            showLoading(false);
        }
    }


    function handleLogout() {
        authToken = null;
        window.location.reload();
    }
    
    function toggleTheme() {
        document.documentElement.classList.toggle('dark');
        document.getElementById('theme-toggle-dark-icon').classList.toggle('hidden');
        document.getElementById('theme-toggle-light-icon').classList.toggle('hidden');
        localStorage.setItem('color-theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
        if (fullSegmentData && Object.keys(fullSegmentData).length) {
            updateCharts(fullSegmentData);
            if (sentimentChart) {
                fetchAndDisplaySentiment();
            }
        }
    }

    function handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            rawCsvText = e.target.result;
            showLoading(true, "Sending data to server for analysis...");

            try {
                const analysisResult = await fetchAPI('/api/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/plain' },
                    body: rawCsvText,
                });

                columnMap = analysisResult.columnMap;
                currentAnalysis = {
                    segmentedData: analysisResult.segmentedData,
                    rawData: Papa.parse(rawCsvText, { header: true, skipEmptyLines: true }).data,
                    analysisDate: new Date().toISOString(),
                    fileName: file.name
                };

                populateLocationFilter(currentAnalysis.rawData);
                await saveAnalysisToHistory(currentAnalysis);
                updateDashboard(currentAnalysis.segmentedData);
                await fetchAndDisplaySentiment();
                
            } catch (error) {
                alert(`Analysis failed: ${error.message}`);
            } finally {
                showLoading(false);
            }
        };
        reader.readAsText(file);
    }

    async function handleLocationFilterChange() {
        if (!currentAnalysis.rawData) return;
        showLoading(true, "Filtering by location...");

        const selectedLocation = locationFilter.value;
        let dataForAnalysis = currentAnalysis.rawData;

        if (selectedLocation !== 'all' && columnMap.location) {
            dataForAnalysis = currentAnalysis.rawData.filter(row => row[columnMap.location.name] === selectedLocation);
        }
        
        const tempCsvText = Papa.unparse(dataForAnalysis);
        try {
            const analysisResult = await fetchAPI('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body: tempCsvText,
            });
            updateDashboard(analysisResult.segmentedData);
            await fetchAndDisplaySentiment();
        } catch (error) {
            alert(`Filtering failed: ${error.message}`);
        } finally {
            showLoading(false);
        }
    }
    
    // --- SETTINGS & HISTORY ---
    async function loadSettings() {
        try {
            const savedSettings = await fetchAPI('/api/settings');
            settings = {
                championRecency: savedSettings?.championRecency || 30,
                championFrequency: savedSettings?.championFrequency || 5,
                atRiskRecency: savedSettings?.atRiskRecency || 90,
            };
        } catch (error) {
            console.error("Failed to load settings:", error);
            alert("Could not load your settings from the server.");
        }
    }

    function openSettings() {
        document.getElementById('championRecency').value = settings.championRecency;
        document.getElementById('championFrequency').value = settings.championFrequency;
        document.getElementById('atRiskRecency').value = settings.atRiskRecency;
        settingsModal.classList.remove('hidden');
    }

    function closeSettings() {
        settingsModal.classList.add('hidden');
    }

    async function saveSettings() {
        settings.championRecency = parseInt(document.getElementById('championRecency').value) || 30;
        settings.championFrequency = parseInt(document.getElementById('championFrequency').value) || 5;
        settings.atRiskRecency = parseInt(document.getElementById('atRiskRecency').value) || 90;

        try {
            await fetchAPI('/api/settings', {
                method: 'POST',
                body: JSON.stringify(settings)
            });
            closeSettings();
            if (currentAnalysis.rawData) {
                showLoading(true, "Re-analyzing with new settings...");
                await handleLocationFilterChange();
                showLoading(false);
            }
        } catch (error) {
            alert("Failed to save settings: " + error.message);
        }
    }

    async function saveAnalysisToHistory(analysis) {
        try {
            await fetchAPI('/api/history', {
                method: 'POST',
                body: JSON.stringify({
                    fileName: analysis.fileName,
                    analysisDate: analysis.analysisDate,
                    segmentedData: analysis.segmentedData
                })
            });
            await loadHistory();
        } catch (error) {
            console.error("Failed to save analysis:", error);
        }
    }

    async function loadHistory() {
        try {
            const history = await fetchAPI('/api/history');
            historySelect.innerHTML = '<option value="none" selected>Select a past dataset...</option>';
            history.forEach(item => {
                const date = new Date(item.analysis_date);
                const option = document.createElement('option');
                option.value = item.id;
                option.textContent = `${item.file_name} (${date.toLocaleDateString()})`;
                historySelect.appendChild(option);
            });
            compareButton.disabled = true;
        } catch (error) {
            console.error("Failed to load history:", error);
            historySelect.innerHTML = '<option value="none" selected>Could not load history</option>';
        }
    }

    async function handleCompare() {
        const selectedId = historySelect.value;
        if (selectedId === 'none' || !fullSegmentData) return;
        
        showLoading(true, "Loading comparison data...");
        try {
            const historicalAnalysis = await fetchAPI(`/api/history/${selectedId}`);
            updateKPIs(fullSegmentData, historicalAnalysis.segmentedData);
        } catch(error) {
            alert("Could not load comparison data: " + error.message);
        } finally {
            showLoading(false);
        }
    }
    
    async function handleClearHistory() {
        if (confirm("Are you sure you want to clear all saved analysis history? This cannot be undone.")) {
            try {
                await fetchAPI('/api/history', { method: 'DELETE' });
                await loadHistory();
            } catch (error) {
                alert("Failed to clear history: " + error.message);
            }
        }
    }

    // --- UI UPDATE & RENDER FUNCTIONS ---
    function populateLocationFilter(data) {
        locationFilter.innerHTML = '<option value="all">All Locations</option>';
        if (!columnMap.location) {
            locationFilterContainer.classList.add('hidden');
            return;
        }
        const labelText = columnMap.location.type.charAt(0).toUpperCase() + columnMap.location.type.slice(1);
        locationFilterLabel.textContent = `Filter by ${labelText}`;
        const locations = [...new Set(data.map(row => row[columnMap.location.name]).filter(Boolean))];
        locations.sort().forEach(loc => {
            const option = document.createElement('option');
            option.value = loc;
            option.textContent = loc;
            locationFilter.appendChild(option);
        });
        locationFilterContainer.classList.remove('hidden');
    }

    function updateDashboard(segmentedData) {
        fullSegmentData = segmentedData;
        updateKPIs(segmentedData);
        updateCharts(segmentedData);
        updateInsights(segmentedData);
        const firstSegment = Object.keys(segmentedData).sort((a,b) => segmentedData[b].customers.length - segmentedData[a].customers.length)[0] || 'Champions';
        filterTable(firstSegment);
    }
    
    function updateKPIs(currentData, historicalData = null) {
        const kpiContainer = document.getElementById('kpiContainer');
        const calcMetrics = (data) => {
            const allCustomers = Object.values(data).flatMap(seg => seg.customers);
            const totalCustomers = new Set(allCustomers.map(c => c.id)).size;
            const totalSpend = allCustomers.reduce((sum, cust) => sum + cust.spend, 0);
            const avgSpend = totalCustomers > 0 ? (totalSpend / totalCustomers) : 0;
            const atRiskCount = data['At-Risk']?.customers.length || 0;
            return { totalCustomers, avgSpend, atRiskCount };
        };
        const currentMetrics = calcMetrics(currentData);
        let historicalMetrics = historicalData ? calcMetrics(historicalData) : null;
        const getComparisonHTML = (current, historical) => {
            if (historical === null || historical === undefined || current === historical || historical === 0) return '';
            const change = ((current - historical) / historical) * 100;
            const colorClass = change >= 0 ? 'comparison-up' : 'comparison-down';
            const sign = change > 0 ? '+' : '';
            return `<span class="text-xs font-medium ${colorClass} ml-2">${sign}${change.toFixed(1)}%</span>`;
        };
        let locationName = locationFilter.value === 'all' ? 'All Locations' : locationFilter.value;
        const kpiTitle = columnMap.location ? `<span class="block text-xs font-semibold text-brand-primary uppercase">${locationName}</span>` : '';
        kpiContainer.innerHTML = `
            <div class="kpi-card bg-brand-card p-6 rounded-xl border border-brand-border">${kpiTitle}<h3 class="text-sm font-medium text-brand-text_secondary">Total Customers</h3><p class="mt-2 text-3xl font-semibold text-brand-text_primary flex items-center">${currentMetrics.totalCustomers.toLocaleString()} ${getComparisonHTML(currentMetrics.totalCustomers, historicalMetrics?.totalCustomers)}</p></div>
            <div class="kpi-card bg-brand-card p-6 rounded-xl border border-brand-border">${kpiTitle}<h3 class="text-sm font-medium text-brand-text_secondary">Average Spend</h3><p class="mt-2 text-3xl font-semibold text-brand-text_primary flex items-center">₱${currentMetrics.avgSpend.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${getComparisonHTML(currentMetrics.avgSpend, historicalMetrics?.avgSpend)}</p></div>
            <div class="kpi-card bg-brand-card p-6 rounded-xl border border-brand-border">${kpiTitle}<h3 class="text-sm font-medium text-brand-text_secondary">At-Risk Customers</h3><p class="mt-2 text-3xl font-semibold text-brand-primary flex items-center">${currentMetrics.atRiskCount.toLocaleString()} ${getComparisonHTML(currentMetrics.atRiskCount, historicalMetrics?.atRiskCount)}</p></div>
            <div class="kpi-card bg-brand-card p-6 rounded-xl border border-brand-border">${kpiTitle}<h3 class="text-sm font-medium text-brand-text_secondary">Champion Customers</h3><p class="mt-2 text-3xl font-semibold text-green-500 flex items-center">${(currentData['Champions']?.customers.length || 0).toLocaleString()} ${getComparisonHTML(currentData['Champions']?.customers.length, historicalData ? (historicalData['Champions']?.customers.length || 0) : null)}</p></div>`;
    }

    function updateCharts(data) {
        updateSegmentDistributionChart(data);
        updateSegmentSpendChart(data);
    }

    function updateSegmentDistributionChart(data) {
        const ctx = document.getElementById('customerSegmentChart').getContext('2d');
        const labels = Object.keys(data);
        const chartValues = labels.map(label => data[label].customers.length);
        const isDark = document.documentElement.classList.contains('dark');
        const colors = ['#F97316', '#3B82F6', '#EF4444', '#8B5CF6', '#6B7280'];
        if (customerSegmentChart) customerSegmentChart.destroy();
        customerSegmentChart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: labels, datasets: [{ data: chartValues, backgroundColor: colors, hoverOffset: 4, borderColor: isDark ? 'rgb(41 37 36)' : 'rgb(255 255 255)' }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { color: isDark ? '#D1D5DB' : '#4B5563' } } },
                onClick: (event, elements) => { if (elements.length > 0) filterTable(labels[elements[0].index]); }
            }
        });
    }

    function updateSegmentSpendChart(data) {
        const ctx = document.getElementById('segmentSpendChart').getContext('2d');
        const labels = Object.keys(data);
        const isDark = document.documentElement.classList.contains('dark');
        const avgSpendValues = labels.map(label => {
            const segment = data[label];
            const totalSpend = segment.customers.reduce((sum, cust) => sum + cust.spend, 0);
            return segment.customers.length > 0 ? totalSpend / segment.customers.length : 0;
        });
        if (segmentSpendChart) segmentSpendChart.destroy();
        segmentSpendChart = new Chart(ctx, {
            type: 'bar',
            data: { labels: labels, datasets: [{ label: 'Average Spend', data: avgSpendValues, backgroundColor: '#F97316' }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { color: isDark ? '#D1D5DB' : '#4B5563', callback: (value) => '₱' + value } },
                    x: { ticks: { color: isDark ? '#D1D5DB' : '#4B5563' } }
                }
            }
        });
    }

    function filterTable(segment = null) {
        if (segment) document.getElementById('tableTitle').dataset.currentSegment = segment;
        const currentSegment = document.getElementById('tableTitle').dataset.currentSegment;
        if (!currentSegment || !fullSegmentData[currentSegment]) {
            renderTable(currentSegment, []);
            return;
        };
        const filterId = document.getElementById('filterId').value.toLowerCase();
        const filterVisits = parseFloat(document.getElementById('filterVisits').value) || 0;
        const filterSpend = parseFloat(document.getElementById('filterSpend').value) || 0;
        const segmentData = fullSegmentData[currentSegment]?.customers || [];
        const filteredData = segmentData.filter(c => String(c.id).toLowerCase().includes(filterId) && c.visits >= filterVisits && c.spend >= filterSpend);
        renderTable(currentSegment, filteredData);
    }
    
    function renderTable(segment, dataToRender) {
        const tableBody = document.getElementById('customerTableBody');
        const tableTitle = document.getElementById('tableTitle');
        const segmentDescription = fullSegmentData[segment]?.description || "Explore customer data below.";
        tableTitle.innerHTML = `<h2 class="text-lg font-semibold">Segment Explorer: ${segment}</h2><p class="text-sm font-normal text-brand-text_secondary mt-1">${segmentDescription}</p>`;
        tableBody.innerHTML = '';
        if (dataToRender.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-brand-text_secondary">No customers found.</td></tr>`;
            return;
        }
        const sortedData = dataToRender.sort((a,b) => b.spend - a.spend).slice(0, 100);
        sortedData.forEach(customer => {
            const row = `<tr class="bg-brand-card border-b border-brand-border hover:bg-brand-bg"><td class="px-6 py-4 font-medium text-brand-text_primary">${customer.id}</td><td class="px-6 py-4">${customer.lastVisit}</td><td class="px-6 py-4">${customer.visits}</td><td class="px-6 py-4 font-semibold">₱${customer.spend.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td></tr>`;
            tableBody.innerHTML += row;
        });
    }

    function updateInsights(data) {
        const insightsContainer = document.getElementById('insightsContainer');
        const growthContainer = document.getElementById('growthContainer');
        insightsContainer.innerHTML = '';
        growthContainer.innerHTML = '';
        const atRiskCount = data['At-Risk']?.customers.length || 0;
        if (atRiskCount > 0) insightsContainer.innerHTML += `<div class="insight-card p-6"><h3 class="font-semibold text-orange-600 dark:text-orange-400">High Churn Risk</h3><p class="text-sm text-brand-text_secondary mt-2">You have ${atRiskCount} at-risk customers. **Action:** Launch a "We Miss You!" campaign to re-engage them.</p></div>`;
        const championsCount = data['Champions']?.customers.length || 0;
        if (championsCount > 0) insightsContainer.innerHTML += `<div class="insight-card p-6"><h3 class="font-semibold text-emerald-600 dark:text-emerald-400">Nurture Champions</h3><p class="text-sm text-brand-text_secondary mt-2">Your ${championsCount} Champions are your most valuable asset. **Action:** Create a VIP program.</p></div>`;
        const newCustomersCount = data['New Customers']?.customers.length || 0;
        const totalCustomers = Object.values(data).reduce((sum, seg) => sum + seg.customers.length, 0);
        if (totalCustomers > 0 && newCustomersCount / totalCustomers > 0.4) growthContainer.innerHTML += `<div class="insight-card p-6"><h3 class="font-semibold text-violet-600 dark:text-violet-400">Convert New Buyers</h3><p class="text-sm text-brand-text_secondary mt-2">A high percentage of your customers are new. **Strategy:** Implement a "welcome" offer.</p></div>`;
        if (championsCount > 10 && (data['Loyal Customers']?.customers.length || 0) > 20) growthContainer.innerHTML += `<div class="insight-card p-6"><h3 class="font-semibold text-blue-600 dark:text-blue-400">Upsell Loyal Customers</h3><p class="text-sm text-brand-text_secondary mt-2">You have a strong base of Loyal Customers. **Strategy:** Promote products that Champions buy to this segment.</p></div>`;
        if(insightsContainer.innerHTML === '') insightsContainer.innerHTML = `<div class="text-brand-text_secondary p-6 bg-brand-card rounded-xl border border-brand-border">No high-priority recommendations. Segments appear healthy.</div>`;
        if(growthContainer.innerHTML === '') growthContainer.innerHTML = `<div class="text-brand-text_secondary p-6 bg-brand-card rounded-xl border border-brand-border">No specific growth opportunities identified.</div>`;
    }
    
    // --- AI & SENTIMENT FUNCTIONS ---
    // **FIX**: This function is now fully implemented to call the backend and get real AI insights.
    async function getAIInsight(type) {
        if (!fullSegmentData || Object.keys(fullSegmentData).length === 0) {
            alert("Please upload and analyze data first.");
            return;
        }
        showLoading(true, "Consulting AI model for strategies...");
        aiInsightContent.innerHTML = "<p>Generating insights...</p>";
        aiInsightModal.classList.remove('hidden');

        // Prepare the data summary to send to the AI
        const dataSummary = Object.entries(fullSegmentData).map(([key, value]) => 
            `${key}: ${value.customers.length} customers`
        ).join(', ');

        let prompt;
        if (type === 'recommendations') {
            prompt = `
                As a marketing analyst for a bakery brand named Cocopan, analyze the following customer segmentation data: ${dataSummary}.
                Based on this, provide a prioritized list of 2-3 key strategic recommendations focusing on customer retention and mitigating churn.
                Format your response as simple HTML with <h4> for titles and <ul>/<li> for bullet points.
            `;
        } else { // growth
            prompt = `
                As a marketing strategist for a bakery brand named Cocopan, analyze the following customer segmentation data: ${dataSummary}.
                Based on this, provide a prioritized list of 2-3 key strategic recommendations focusing on growth opportunities, such as upselling or converting new customers.
                Format your response as simple HTML with <h4> for titles and <ul>/<li> for bullet points.
            `;
        }

        try {
            const response = await fetchAPI('/api/ai-insight', {
                method: 'POST',
                body: JSON.stringify({ prompt })
            });
            aiInsightContent.innerHTML = response.insight;
        } catch (error) {
            aiInsightContent.innerHTML = `<p class="text-red-500">Failed to get AI insight. Please ensure your Gemini API key is correctly configured. Error: ${error.message}</p>`;
        } finally {
            showLoading(false);
        }
    }

    async function fetchAndDisplaySentiment() {
        const sentimentContainer = document.getElementById('sentimentContainer');
        sentimentContainer.innerHTML = `
            <div class="h-64 flex items-center justify-center">
                <canvas id="sentimentChart"></canvas>
            </div>
            <div id="sentimentMentions" class="space-y-3"></div>
        `;
    
        const mentionsContainer = document.getElementById('sentimentMentions');
        
        mentionsContainer.innerHTML = `<p class="text-brand-text_secondary">Fetching recent comments from Facebook Page...</p>`;
        if (sentimentChart) sentimentChart.destroy();
    
        try {
            const sentimentData = await fetchAPI('/api/sentiment', {
                method: 'POST',
            });
    
            mentionsContainer.innerHTML = `<p class="text-sm text-brand-text_secondary mb-4">Sentiment from recent Facebook Page comments:</p>`;
            
            const sentimentEmojis = { positive: '😊', negative: '😠', neutral: '🤔' };
    
            if (sentimentData.mentions.length === 0) {
                 mentionsContainer.innerHTML += `<p class="text-brand-text_secondary">No recent comments found to analyze.</p>`;
            } else {
                sentimentData.mentions.forEach(mention => {
                    mentionsContainer.innerHTML += `
                        <div class="flex items-start gap-3 p-3 bg-brand-bg rounded-lg">
                            <span class="text-xl">${sentimentEmojis[mention.sentiment] || '💬'}</span>
                            <div>
                                <p class="font-semibold text-brand-text_primary">${mention.author}</p>
                                <p class="text-sm text-brand-text_secondary">${mention.text}</p>
                            </div>
                        </div>
                    `;
                });
            }
    
            // Update chart
            const ctx = document.getElementById('sentimentChart').getContext('2d');
            const isDark = document.documentElement.classList.contains('dark');
            const colors = ['#22C55E', '#848A96', '#EF4444']; // Green, Gray, Red
            
            sentimentChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Positive', 'Neutral', 'Negative'],
                    datasets: [{
                        data: [sentimentData.scores.positive, sentimentData.scores.neutral, sentimentData.scores.negative],
                        backgroundColor: colors,
                        hoverOffset: 4,
                        borderColor: isDark ? 'rgb(41 37 36)' : 'rgb(255 255 255)'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: isDark ? '#D1D5DB' : '#4B5563' } }
                    }
                }
            });
    
        } catch (error) {
            mentionsContainer.innerHTML = `<p class="text-red-500">Could not load Facebook sentiment data. Error: ${error.message}</p>`;
            console.error(error);
        }
    }

    // --- UTILITY FUNCTIONS ---
    function showLoading(isLoading, text = "Processing data...") {
        loadingText.textContent = text;
        loadingModal.classList.toggle('hidden', !isLoading);
    }

    function initializeDashboard() {
        const kpiContainer = document.getElementById('kpiContainer');
        const insightsContainer = document.getElementById('insightsContainer');
        const growthContainer = document.getElementById('growthContainer');
        kpiContainer.innerHTML = Array(4).fill(`<div class="kpi-card bg-brand-card p-6 rounded-xl border border-brand-border animate-pulse"><div class="h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/3 mb-4"></div><div class="h-8 bg-gray-400 dark:bg-gray-500 rounded w-1/2"></div></div>`).join('');
        insightsContainer.innerHTML = `<p class="text-brand-text_secondary p-6 bg-brand-card rounded-xl border border-brand-border">Upload a CSV file to see recommendations.</p>`;
        growthContainer.innerHTML = `<p class="text-brand-text_secondary p-6 bg-brand-card rounded-xl border border-brand-border">Upload a CSV file to see growth opportunities.</p>`;
        document.getElementById('customerTableBody').innerHTML = `<tr><td colspan="4" class="text-center py-8 text-brand-text_secondary">Upload a CSV with customer data to get started.</td></tr>`;
        document.getElementById('sentimentContainer').innerHTML = `<p class="text-brand-text_secondary text-center col-span-2">Upload a CSV to generate sentiment analysis.</p>`;
        updateCharts({});
        locationFilterContainer.classList.add('hidden');
    }
});
