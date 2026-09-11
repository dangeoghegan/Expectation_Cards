/**
 * ClassroomService.js
 * Integrates with Google Classroom API (Advanced Service).
 */

const ClassroomService = {
  /**
   * Lists active courses for the current user where they are a teacher.
   */
  listCourses() {
    try {
      const response = Classroom.Courses.list({
        courseStates: ['ACTIVE'],
        teacherId: 'me'
      });
      return (response.courses || []).map(course => ({
        id: course.id,
        name: course.name,
        section: course.section || ''
      }));
    } catch (e) {
      console.error('Error listing courses:', e);
      throw new Error('Failed to retrieve Classroom courses.');
    }
  },

  /**
   * Lists students in a specific course.
   */
  listStudents(courseId) {
    try {
      const response = Classroom.Courses.Students.list(courseId);
      return (response.students || []).map(student => ({
        userId: student.userId,
        email: student.profile.emailAddress,
        name: student.profile.name.fullName
      }));
    } catch (e) {
      console.error(`Error listing students for course ${courseId}:`, e);
      throw new Error('Failed to retrieve course roster.');
    }
  },

  /**
   * Lists assignments (coursework) for a course.
   */
  listAssignments(courseId) {
    try {
      const response = Classroom.Courses.CourseWork.list(courseId, {
        courseWorkStates: ['PUBLISHED', 'DRAFT']
      });
      return (response.courseWork || []).filter(cw => cw.workType === 'ASSIGNMENT').map(cw => ({
        id: cw.id,
        title: cw.title,
        state: cw.state
      }));
    } catch (e) {
      console.error(`Error listing assignments for course ${courseId}:`, e);
      throw new Error('Failed to retrieve course assignments.');
    }
  },

  /**
   * Creates a new assignment.
   */
  createAssignment(courseId, title, assigneeMode, studentIds = []) {
    try {
      const courseWork = {
        title: title,
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        assigneeMode: assigneeMode, // 'ALL_STUDENTS' or 'INDIVIDUAL_STUDENTS'
      };

      if (assigneeMode === 'INDIVIDUAL_STUDENTS' && studentIds.length > 0) {
        courseWork.individualStudentsOptions = {
          studentIds: studentIds
        };
      }

      const response = Classroom.Courses.CourseWork.create(courseWork, courseId);
      return {
        id: response.id,
        title: response.title
      };
    } catch (e) {
      console.error(`Error creating assignment for course ${courseId}:`, e);
      throw new Error('Failed to create linked assignment.');
    }
  },

  /**
   * Attaches a link to a specific student's submission.
   * Note: Classroom API requires the caller to be the student OR the teacher to modify attachments,
   * but attaching links to student submissions programmatically as a teacher has specific rules.
   * We attach it to the coursework if it's an individual assignment, or we use StudentSubmissions.modifyAttachments.
   */
  attachLinkToSubmission(courseId, courseWorkId, userId, linkUrl, linkTitle) {
    try {
      // Find the specific submission for this user
      const response = Classroom.Courses.CourseWork.StudentSubmissions.list(courseId, courseWorkId, {
        userId: userId
      });

      if (!response.studentSubmissions || response.studentSubmissions.length === 0) {
        throw new Error(`No submission found for student ${userId}`);
      }

      const submission = response.studentSubmissions[0];

      // Modify attachments
      const modifyReq = {
        addAttachments: [{
          link: {
            url: linkUrl,
            title: linkTitle
          }
        }]
      };

      Classroom.Courses.CourseWork.StudentSubmissions.modifyAttachments(
        modifyReq,
        courseId,
        courseWorkId,
        submission.id
      );

      return {
        submissionId: submission.id,
        status: 'SUCCESS'
      };
    } catch (e) {
      console.error(`Error attaching link to submission:`, e);
      return {
         status: 'ERROR',
         error: e.message
      };
    }
  }
};
