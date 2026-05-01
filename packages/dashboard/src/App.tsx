import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { initTimezone } from './timezone';
import Layout from './components/Layout';
import Overview from './pages/Overview';
import CategoryWeights from './pages/CategoryWeights';
import UserInsights from './pages/UserInsights';
import ConversationHistory from './pages/ConversationHistory';
import ActivityLog from './pages/ActivityLog';
import ConstantsPage from './pages/Constants';
// New pages
import PersonalityConfig from './pages/PersonalityConfig';
import ModelsLimits from './pages/ModelsLimits';
import ProactiveConfig from './pages/ProactiveConfig';
import SupportLog from './pages/SupportLog';
import CronJobsPage from './pages/CronJobsPage';
import McpServersPage from './pages/McpServersPage';
import BotManagement from './pages/BotManagement';
import StampCompetition from './pages/StampCompetition';
import GlobalConfig from './pages/GlobalConfig';
import LocalModelsPage from './pages/LocalModelsPage';
import BotWizard from './pages/BotWizard';
import ProfilePage from './pages/ProfilePage';
import EmberChatPage from './pages/EmberChatPage';
import VoiceEnrollPage from './pages/VoiceEnrollPage';
import ThoughtTracePage from './pages/ThoughtTracePage';

export default function App() {
  useEffect(() => { initTimezone(); }, []);

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Dashboard */}
        <Route path="/" element={<Overview />} />
        <Route path="/activity" element={<ActivityLog />} />
        {/* Bot Settings */}
        <Route path="/bot/personality" element={<PersonalityConfig />} />
        <Route path="/bot/models" element={<ModelsLimits />} />
        <Route path="/bot/proactive" element={<ProactiveConfig />} />
        <Route path="/bot/support-log" element={<SupportLog />} />
        <Route path="/bot/cron-jobs" element={<CronJobsPage />} />
        <Route path="/bot/mcp-servers" element={<McpServersPage />} />
        {/* Knowledge */}
        <Route path="/insights" element={<UserInsights />} />
        <Route path="/weights" element={<CategoryWeights />} />
        <Route path="/constants" element={<ConstantsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/thought-trace" element={<ThoughtTracePage />} />
        {/* System */}
        <Route path="/system/bots" element={<BotManagement />} />
        <Route path="/system/bots/new" element={<BotWizard />} />
        <Route path="/system/stamps" element={<StampCompetition />} />
        <Route path="/system/local-models" element={<LocalModelsPage />} />
        <Route path="/system/global" element={<GlobalConfig />} />
        {/* Tools */}
        <Route path="/ember-chat" element={<EmberChatPage />} />
        <Route path="/voice-enroll" element={<VoiceEnrollPage />} />
      </Route>
    </Routes>
  );
}
