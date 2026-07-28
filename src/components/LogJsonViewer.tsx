import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

interface JsonNodeViewerProps {
  data: any;
  nodeKey?: string;
  isExpandedInitially?: boolean;
  requestData?: (dataId: string) => void;
  loadedDataCache?: Map<string, any>;
}

const JsonNodeViewer: React.FC<JsonNodeViewerProps> = ({
  data,
  isExpandedInitially = false,
  requestData,
  loadedDataCache,
}) => {
  const [isExpanded, setIsExpanded] = useState(isExpandedInitially);

  // 1. Handle lazy-loading reference
  if (data && typeof data === 'object' && (data as any).__ref) {
    const dataId = (data as any).__ref;
    const cachedData = loadedDataCache?.get(dataId);
    const isLoading = isExpanded && !cachedData;

    const handleToggle = async () => {
      const newExpandedState = !isExpanded;
      setIsExpanded(newExpandedState);
      if (newExpandedState && !cachedData && requestData) {
        requestData(dataId);
      }
    };

    // Collapsed: show chevron + preview only
    if (!isExpanded) {
      return (
        <span className="inline-block align-top">
          <span className="cursor-pointer" onClick={handleToggle}>
            <ChevronRight size={14} className="inline-block mr-1 align-middle text-gray-500" />
            <span className="text-gray-400 align-middle">{(data as any).__preview}</span>
          </span>
        </span>
      );
    }

    // Expanded
    if (isLoading) {
      return (
        <span className="inline-block align-top">
          <span className="inline-flex align-top">
            <span className="flex-none pr-1">
              <span className="cursor-pointer" onClick={handleToggle}>
                <ChevronDown size={14} className="inline-block align-middle text-gray-500" />
              </span>
            </span>
            <span className="text-yellow-400">Loading...</span>
          </span>
        </span>
      );
    }

    // Render expanded braces and children using cachedData
    const isArray = Array.isArray(cachedData);
    const keys = Object.keys(cachedData as any);
    const bracketStart = isArray ? '[' : '{';
    const bracketEnd = isArray ? ']' : '}';

    return (
      <span className="inline-block align-top">
        <span className="inline-flex align-top">
          {/* Left column: chevron */}
          <span className="flex-none pr-1">
            <span className="cursor-pointer" onClick={handleToggle}>
              <ChevronDown size={14} className="inline-block align-middle text-gray-500" />
            </span>
          </span>
          {/* Right column: content with braces and children */}
          <span>
            <div className="cursor-pointer" onClick={handleToggle}>{bracketStart}</div>
            <div className="ml-4">
              {keys.map(key => (
                <div key={key}>
                  {!isArray && <span className="text-pink-400 mr-1">{key}:</span>}
                  <JsonNodeViewer
                    data={(cachedData as any)[key]}
                    nodeKey={key}
                    isExpandedInitially={false}
                    requestData={requestData}
                    loadedDataCache={loadedDataCache}
                  />
                </div>
              ))}
            </div>
            <div>{bracketEnd}</div>
          </span>
        </span>
      </span>
    );
  }

  // 2. Render primitives
  if (data === null) return <span className="text-purple-400">null</span>;
  if (typeof data !== 'object') {
    const className =
      typeof data === 'string'
        ? 'text-green-400'
        : typeof data === 'number'
        ? 'text-blue-400'
        : 'text-purple-400';
    const displayValue = typeof data === 'string' ? `"${data}"` : String(data);
    return <span className={className}>{displayValue}</span>;
  }
  
  // 3. Render regular (eager) objects/arrays
  const isArray = Array.isArray(data);
  const keys = Object.keys(data as any);
  if (keys.length === 0) return <span>{isArray ? '[]' : '{}'}</span>;

  const handleToggle = () => setIsExpanded(!isExpanded);
  
  const bracketStart = isArray ? '[' : '{';
  const bracketEnd = isArray ? ']' : '}';
  
  if (!isExpanded) {
    return (
      <span className="cursor-pointer text-gray-400" onClick={handleToggle}>
        <ChevronRight size={14} className="inline-block mr-1 align-middle" />
        {isArray ? `Array(${keys.length})` : `Object(${keys.length})`}
      </span>
    );
  }

  // Expanded view: two-column layout so braces align consistently (not with chevron)
  return (
    <span className="inline-block align-top">
      <span className="inline-flex align-top">
        {/* Left column: chevron */}
        <span className="flex-none pr-1">
          <span className="cursor-pointer" onClick={handleToggle}>
            <ChevronDown size={14} className="inline-block align-middle text-gray-500" />
          </span>
        </span>
        {/* Right column: content with braces and children */}
        <span>
          <div className="cursor-pointer" onClick={handleToggle}>{bracketStart}</div>
          <div className="ml-4">
            {keys.map(key => (
              <div key={key}>
                {!isArray && <span className="text-pink-400 mr-1">{key}:</span>}
                <JsonNodeViewer
                  data={(data as any)[key]}
                  nodeKey={key}
                  isExpandedInitially={false} // Nested nodes are not expanded by default
                  requestData={requestData}
                  loadedDataCache={loadedDataCache}
                />
              </div>
            ))}
          </div>
          <div>{bracketEnd}</div>
        </span>
      </span>
    </span>
  );
};

interface LogJsonViewerProps {
  data: any;
  requestData?: (dataId: string) => void;
  loadedDataCache?: Map<string, any>;
}

const LogJsonViewer: React.FC<LogJsonViewerProps> = ({ data, requestData, loadedDataCache }) => {
  if (!data) return null;
  return (
    <span className="inline-block font-mono text-xs text-white align-top">
      <JsonNodeViewer
        data={data}
        isExpandedInitially={false} // Top-level is not expanded by default
        requestData={requestData}
        loadedDataCache={loadedDataCache}
      />
    </span>
  );
};

export default LogJsonViewer;
