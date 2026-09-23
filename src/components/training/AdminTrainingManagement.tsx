import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  GraduationCap, 
  Search, 
  Plus, 
  Edit3
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import { AdminPermission } from '../../types/admin';
import { WorkflowState } from '../../types/workflow';
import { AdminAccessService } from '../../services/adminAccess';
import type { TrainingCourse } from '../../types/training';
import { TrainingCourseService } from '../../services/trainingCourseService';
import { TrainingCourseEditorModal } from './TrainingCourseEditorModal';
import { getCategoryLabel } from '../content/contentFormatters';

interface AdminTrainingManagementProps {
  currentUser: AdminUser;
}

export function AdminTrainingManagement({ currentUser }: AdminTrainingManagementProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Search & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedLevel, setSelectedLevel] = useState<string>('ALL');
  const [selectedDelivery, setSelectedDelivery] = useState<string>('ALL');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('ALL');

  // Modal State
  const [activeCourse, setActiveCourse] = useState<TrainingCourse | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const canCreate = AdminAccessService.hasPermission(currentUser, AdminPermission.Create);

  const fetchCourses = async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const fetched = await TrainingCourseService.listCourses(undefined, true);
      setCourses(fetched);
    } catch (err: any) {
      console.error('Error loading training courses:', err);
      setLoadError(err?.message || 'Failed to load training courses.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  // Filtered Courses Computation
  const filteredCourses = useMemo(() => {
    return courses.filter((course) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitleAr = course.titleAr.toLowerCase().includes(q);
        const matchTitleEn = course.titleEn.toLowerCase().includes(q);
        const matchSummaryAr = course.summaryAr.toLowerCase().includes(q);
        const matchSummaryEn = course.summaryEn.toLowerCase().includes(q);
        const matchInstructor = (course.instructorNameAr || '').toLowerCase().includes(q) ||
                                (course.instructorNameEn || '').toLowerCase().includes(q);
        if (!matchTitleAr && !matchTitleEn && !matchSummaryAr && !matchSummaryEn && !matchInstructor) {
          return false;
        }
      }

      // Category
      if (selectedCategory !== 'ALL' && course.category !== selectedCategory) {
        return false;
      }

      // Level
      if (selectedLevel !== 'ALL' && course.level !== selectedLevel) {
        return false;
      }

      // Delivery Mode
      if (selectedDelivery !== 'ALL' && course.deliveryMode !== selectedDelivery) {
        return false;
      }

      // Workflow State
      if (selectedWorkflow !== 'ALL' && course.workflowState !== selectedWorkflow) {
        return false;
      }

      return true;
    });
  }, [courses, searchQuery, selectedCategory, selectedLevel, selectedDelivery, selectedWorkflow]);

  const handleSaveCourse = async (savedCourse: TrainingCourse): Promise<void> => {
    try {
      const persisted = await TrainingCourseService.saveCourse(savedCourse, currentUser);
      setCourses((prev) => {
        const exists = prev.some((c) => c.id === persisted.id);
        if (exists) {
          return prev.map((c) => (c.id === persisted.id ? persisted : c));
        }
        return [persisted, ...prev];
      });
      setActiveCourse(persisted);
    } catch (err: any) {
      console.error('Error saving training course:', err);
      throw err;
    }
  };

  const handleCreateNew = () => {
    const newCourse: TrainingCourse = {
      id: `course-${Date.now()}`,
      titleAr: 'مسار تدريبي بيئي جديد قيد التأسيس',
      titleEn: 'New Environmental Training Course Under Drafting',
      summaryAr: 'ملخص أولي للمنهج التدريبي البيئي...',
      summaryEn: 'Initial summary of the environmental training curriculum...',
      category: 'Climate',
      level: 'Beginner',
      durationHours: 16,
      deliveryMode: 'OnlineSelfPaced',
      targetAudienceAr: 'الباحثون والمهتمون بالعمل البيئي',
      targetAudienceEn: 'Researchers and environmental practitioners',
      instructorNameAr: currentUser.name,
      instructorNameEn: currentUser.name,
      instructorBioAr: 'خبير معتمد في برامج بناء القدرات البيئية للمنصة.',
      instructorBioEn: 'Certified expert in environmental capacity building programs.',
      workflowState: WorkflowState.Draft,
      workflowHistory: [
        {
          id: `tr-init-${Date.now()}`,
          fromState: WorkflowState.Draft,
          toState: WorkflowState.Draft,
          action: 'submit_for_review',
          actorName: currentUser.name,
          actorRole: currentUser.role,
          timestamp: new Date().toISOString(),
          comment: 'Initial draft course created in back-office.',
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      author: currentUser.name,
      language: isAr ? 'ar' : 'en',
    };

    setActiveCourse(newCourse);
    setIsModalOpen(true);
  };

  const getWorkflowBadge = (state: WorkflowState) => {
    switch (state) {
      case WorkflowState.Published:
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border-blue-300';
      case WorkflowState.Approved:
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300';
      case WorkflowState.InReview:
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300';
      case WorkflowState.ChangesRequested:
        return 'bg-orange-100 text-orange-800 dark:bg-orange-950/80 dark:text-orange-300 border-orange-300';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-300';
    }
  };

  const levelLabels: Record<string, { ar: string; en: string }> = {
    Beginner: { ar: 'مبتدئ / تأسيسي', en: 'Foundational' },
    Intermediate: { ar: 'متوسط / تطبيقي', en: 'Intermediate' },
    Advanced: { ar: 'متقدم / تخصصي', en: 'Advanced' },
  };

  const modeLabels: Record<string, { ar: string; en: string }> = {
    OnlineSelfPaced: { ar: 'تدريب رقمي ذاتي', en: 'Self-Paced Online' },
    LiveWorkshop: { ar: 'ورشة عمل تفاعلية', en: 'Interactive Workshop' },
    FieldCohort: { ar: 'تدريب ميداني تطبيقي', en: 'Field Practicum Cohort' },
  };

  if (loadError) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-gray-900 p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                {isAr ? 'إدارة البرامج والتدريب البيئي' : 'Training & Courses Management'}
              </h1>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center space-y-4">
          <p className="text-red-500 font-medium">
            {isAr ? 'حدث خطأ أثناء تحميل البرامج التدريبية.' : 'An error occurred while loading training courses.'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">{loadError}</p>
          <button
            onClick={fetchCourses}
            className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs sm:text-sm font-bold shadow-xs transition-colors cursor-pointer animate-none"
          >
            {isAr ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-24 space-y-3">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
          {isAr ? 'جاري تحميل البرامج التدريبية...' : 'Loading training courses...'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Header & Title Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-gray-900 p-5 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
              <GraduationCap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-gray-900 dark:text-white tracking-tight">
                {isAr ? 'إدارة البرامج والتدريب البيئي' : 'Training & Courses Management'}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isAr 
                  ? 'إدارة المناهج، ورش العمل التدريبية، ودورات بناء القدرات عبر سير العمل المؤسسي للمنصة.'
                  : 'Manage training curricula, workshops, and capacity-building cohorts via institutional workflow.'}
              </p>
            </div>
          </div>
        </div>

        {canCreate && (
          <button
            onClick={handleCreateNew}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-sm shadow-sm transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{isAr ? 'إضافة برنامج تدريبي جديد' : 'Create New Course'}</span>
          </button>
        )}
      </div>

      {/* Toolbar / Search & Filters */}
      <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row gap-3">
          
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isAr ? 'بحث في العناوين، الملخصات، أو أسماء المدربين...' : 'Search titles, summaries, or instructors...'}
              className="w-full ps-9 pe-4 py-2.5 text-xs sm:text-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/50 text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 outline-hidden"
            />
          </div>

          {/* Filters Bar */}
          <div className="flex flex-wrap gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 text-xs font-semibold rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 outline-hidden"
            >
              <option value="ALL">{isAr ? 'كل المجالات' : 'All Categories'}</option>
              <option value="Climate">Climate</option>
              <option value="Water">Water</option>
              <option value="Biodiversity">Biodiversity</option>
              <option value="Pollution">Pollution</option>
              <option value="Energy">Energy</option>
              <option value="Agriculture">Agriculture</option>
              <option value="EnvironmentalPolicy">EnvironmentalPolicy</option>
            </select>

            <select
              value={selectedLevel}
              onChange={(e) => setSelectedLevel(e.target.value)}
              className="px-3 py-2 text-xs font-semibold rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 outline-hidden"
            >
              <option value="ALL">{isAr ? 'كل المستويات' : 'All Levels'}</option>
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>

            <select
              value={selectedDelivery}
              onChange={(e) => setSelectedDelivery(e.target.value)}
              className="px-3 py-2 text-xs font-semibold rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 outline-hidden"
            >
              <option value="ALL">{isAr ? 'كل طرق التدريب' : 'All Delivery Modes'}</option>
              <option value="OnlineSelfPaced">OnlineSelfPaced</option>
              <option value="LiveWorkshop">LiveWorkshop</option>
              <option value="FieldCohort">FieldCohort</option>
            </select>

            <select
              value={selectedWorkflow}
              onChange={(e) => setSelectedWorkflow(e.target.value)}
              className="px-3 py-2 text-xs font-semibold rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 outline-hidden"
            >
              <option value="ALL">{isAr ? 'كل حالات سير العمل' : 'All Workflow States'}</option>
              <option value={WorkflowState.Draft}>Draft</option>
              <option value={WorkflowState.InReview}>InReview</option>
              <option value={WorkflowState.ChangesRequested}>ChangesRequested</option>
              <option value={WorkflowState.Approved}>Approved</option>
              <option value={WorkflowState.Published}>Published</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-800">
          <span>
            {isAr ? `إجمالي البرامج المعروضة: ${filteredCourses.length}` : `Showing courses: ${filteredCourses.length}`}
          </span>
          {(searchQuery || selectedCategory !== 'ALL' || selectedLevel !== 'ALL' || selectedDelivery !== 'ALL' || selectedWorkflow !== 'ALL') && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('ALL');
                setSelectedLevel('ALL');
                setSelectedDelivery('ALL');
                setSelectedWorkflow('ALL');
              }}
              className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline cursor-pointer"
            >
              {isAr ? 'إعادة ضبط الفلاتر' : 'Reset filters'}
            </button>
          )}
        </div>
      </div>

      {/* Main Content Presentation (<1280px Compact Cards, >=1280px Management Table) */}
      {courses.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center justify-center mx-auto">
            <GraduationCap className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-200">
            {isAr ? 'لا توجد برامج تدريبية مسجلة في النظام' : 'No training courses registered in system'}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            {isAr ? 'لم يتم إضافة أي برامج تدريبية بعد في النظام.' : 'No training courses have been added to the system yet.'}
          </p>
        </div>
      ) : filteredCourses.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center justify-center mx-auto">
            <GraduationCap className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-gray-800 dark:text-gray-200">
            {isAr ? 'لا توجد برامج تدريبية مطابقة لمعايير البحث' : 'No training courses match your criteria'}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
            {isAr ? 'حاول تغيير شروط البحث أو الفلاتر المحددة للوصول للبرنامج المطلوب.' : 'Try adjusting your search query or filters to find what you are looking for.'}
          </p>
        </div>
      ) : (
        <>
          {/* <1280px: Compact Management Cards Presentation */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:hidden gap-4">
            {filteredCourses.map((course) => (
              <div 
                key={course.id}
                className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-xs flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                      {getCategoryLabel(course.category, isAr)}
                    </span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold border ${getWorkflowBadge(course.workflowState)}`}>
                      {course.workflowState}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-gray-900 dark:text-white leading-snug">
                    {isAr ? course.titleAr : course.titleEn}
                  </h3>

                  <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2">
                    {isAr ? course.summaryAr : course.summaryEn}
                  </p>
                </div>

                <div className="pt-3 border-t border-gray-100 dark:border-gray-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between text-gray-500 dark:text-gray-400">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      {isAr ? modeLabels[course.deliveryMode]?.ar : modeLabels[course.deliveryMode]?.en}
                    </span>
                    <span>{course.durationHours} {isAr ? 'ساعة' : 'Hrs'}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-gray-400 truncate max-w-[180px]">
                      {isAr ? course.instructorNameAr || course.author : course.instructorNameEn || course.author}
                    </span>
                    <button
                      onClick={() => {
                        setActiveCourse(course);
                        setIsModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-bold hover:bg-emerald-100 transition-colors cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>{isAr ? 'إدارة وتعديل' : 'Edit & Manage'}</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* >=1280px: Dense Management Table Presentation */}
          <div className="hidden xl:block bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-start border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-50/75 dark:bg-gray-950/75 border-b border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">
                    <th className="py-3.5 px-4 text-start">{isAr ? 'عنوان البرنامج والمجال' : 'Course Title & Domain'}</th>
                    <th className="py-3.5 px-4 text-start">{isAr ? 'المستوى وطريقة التدريب' : 'Level & Delivery Mode'}</th>
                    <th className="py-3.5 px-4 text-start">{isAr ? 'المدة' : 'Duration'}</th>
                    <th className="py-3.5 px-4 text-start">{isAr ? 'المدرب / المؤلف' : 'Instructor / Author'}</th>
                    <th className="py-3.5 px-4 text-start">{isAr ? 'سير العمل' : 'Workflow State'}</th>
                    <th className="py-3.5 px-4 text-end">{isAr ? 'الإجراءات' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredCourses.map((course) => (
                    <tr key={course.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-900/40 transition-colors">
                      <td className="py-3.5 px-4 space-y-1">
                        <div className="font-bold text-gray-900 dark:text-white text-sm max-w-md truncate">
                          {isAr ? course.titleAr : course.titleEn}
                        </div>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                          {getCategoryLabel(course.category, isAr)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 space-y-1 text-gray-600 dark:text-gray-300">
                        <div className="font-semibold">
                          {isAr ? levelLabels[course.level]?.ar : levelLabels[course.level]?.en}
                        </div>
                        <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                          {isAr ? modeLabels[course.deliveryMode]?.ar : modeLabels[course.deliveryMode]?.en}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-medium text-gray-700 dark:text-gray-300">
                        {course.durationHours} {isAr ? 'ساعة' : 'Hrs'}
                      </td>
                      <td className="py-3.5 px-4 text-gray-700 dark:text-gray-300">
                        <div className="font-medium truncate max-w-[140px]">
                          {isAr ? course.instructorNameAr || course.author : course.instructorNameEn || course.author}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${getWorkflowBadge(course.workflowState)}`}>
                          {course.workflowState}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-end">
                        <button
                          onClick={() => {
                            setActiveCourse(course);
                            setIsModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-bold hover:bg-emerald-100 transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>{isAr ? 'إدارة وتعديل' : 'Edit'}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Course Editor Modal */}
      {isModalOpen && (
        <TrainingCourseEditorModal
          course={activeCourse}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setActiveCourse(null);
          }}
          onSave={handleSaveCourse}
          currentUser={currentUser}
        />
      )}

    </div>
  );
}
