import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopBar } from './TopBar';
import { LeftNav } from './LeftNav';
import { RightToc } from './RightToc';

export type TocHeading = {
  id: string;
  level: number;
  text: string;
};

export function Layout() {
  const [headings, setHeadings] = useState<TocHeading[]>([]);
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <TopBar />
      <div className="flex-1 max-w-[90rem] w-full mx-auto flex">
        <aside className="w-64 flex-shrink-0 hidden md:block border-r border-slate-200 bg-slate-50">
          <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto px-4 py-8">
            <LeftNav />
          </div>
        </aside>
        
        <main className="flex-1 min-w-0 px-4 py-8 md:px-12 bg-white ring-1 ring-slate-100 shadow-sm">
          <div className="max-w-3xl mx-auto prose prose-slate">
            <Outlet context={{ setHeadings }} />
          </div>
        </main>
        
        <aside className="w-64 flex-shrink-0 hidden xl:block">
          <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto px-6 py-8">
            <RightToc headings={headings} />
          </div>
        </aside>
      </div>
    </div>
  );
}
