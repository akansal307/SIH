import { useState } from "react";
import type { RouteRecommendation } from "./types/flood";
import { useFloodData } from "./hooks/useFloodData";
import { useSimulation } from "./hooks/useSimulation";
import { TopBar } from "./components/layout/TopBar";
import { StatusBanner } from "./components/layout/StatusBanner";
import { FloodMap } from "./components/map/FloodMap";
import { RiskPanel } from "./components/panels/RiskPanel";
import { WeatherPanel } from "./components/panels/WeatherPanel";
import { LiveAlerts } from "./components/panels/LiveAlerts";
import { StreetDetails } from "./components/panels/StreetDetails";
import { RoutePanel } from "./components/panels/RoutePanel";
import { SimulationPanel } from "./components/controls/SimulationPanel";
import { ForecastTimeline } from "./components/timeline/ForecastTimeline";

export default function App() {
  const floodData = useFloodData();
  const simulation = useSimulation();
  const [activeRoute, setActiveRoute] =
    useState<RouteRecommendation | null>(null);

  return (
    <div className="flex flex-col h-screen bg-void overflow-hidden">
      <TopBar
        mode={floodData.mode}
        onModeChange={floodData.setMode}
        connection={floodData.connection}
        lastUpdated={floodData.lastUpdated}
        onRefresh={floodData.refreshNow}
        isLoading={floodData.isLoading}
      />

      <StatusBanner
        mode={floodData.mode}
        connection={floodData.connection}
        lastUpdated={floodData.lastUpdated}
      />

      <div className="flex flex-1 min-h-0">
        <main className="flex-1 min-w-0 relative">
          <FloodMap
            selectedStreetId={floodData.selectedStreetId}
            onSelectStreet={floodData.selectStreet}
            activeRoute={activeRoute}
          />
        </main>

        <aside className="w-[350px] shrink-0 border-l border-hairline bg-void overflow-y-auto">
          <div className="p-3 space-y-3">
            {floodData.mode === "SIMULATION" && (
              <SimulationPanel
                presets={simulation.presets}
                isRunning={simulation.isRunning}
                error={simulation.error}
                fallbackNote={simulation.fallbackNote}
                activeNotes={floodData.activeSimulationNotes}
                onRun={(id) =>
                  simulation.run(id, floodData.applySimulationResult)
                }
              />
            )}

            <StreetDetails
              street={floodData.selectedStreet}
              onClose={() => floodData.selectStreet(null)}
            />

            <RiskPanel
              state={floodData.currentState}
              isLoading={floodData.isLoading}
            />

            <WeatherPanel
              state={floodData.currentState}
              isLoading={floodData.isLoading}
            />

            <LiveAlerts
              alerts={floodData.currentState?.alerts ?? []}
              isLoading={floodData.isLoading}
              selectedZoneId={floodData.selectedZoneId}
              onSelectZone={floodData.selectZone}
            />

            <RoutePanel
              streetRisk={floodData.selectedStreet}
              point={floodData.selectedStreetPoint}
              onRouteChange={setActiveRoute}
            />
          </div>
        </aside>
      </div>

      <ForecastTimeline
        forecast={floodData.forecast}
        selectedOffset={floodData.selectedOffset}
        onSelect={floodData.selectOffset}
        isLoading={floodData.isLoading}
      />
    </div>
  );
}
