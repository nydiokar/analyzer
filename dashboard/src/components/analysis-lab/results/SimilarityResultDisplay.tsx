import { ComprehensiveSimilarityResult } from "./types";
import { KeyInsights } from "./KeyInsights";
import { MostCommonTokens } from "./MostCommonTokens";
import { TopSimilarPairs } from "./TopSimilarPairs";
import { AllPairsConnections } from "./AllPairsConnections";

interface SimilarityResultDisplayProps {
  results: ComprehensiveSimilarityResult;
}

export function SimilarityResultDisplay({ results }: SimilarityResultDisplayProps) {
  return (
    <div className="space-y-8 mt-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
           <KeyInsights results={results} />
        </div>
        <div className="xl:col-span-1">
          <MostCommonTokens results={results} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-2">
            <TopSimilarPairs results={results} />
        </div>
        <div className="xl:col-span-3">
            <AllPairsConnections results={results} />
        </div>
      </div>
    </div>
  );
} 