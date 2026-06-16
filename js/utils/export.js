// js/utils/export.js - PDF export utility

/**
 * Shared helpers for consistent PDF layout, typography, and spacing.
 */
const PdfLayout = {
  marginLeft: 20,
  marginRight: 20,
  defaultFont: 'helvetica',
  defaultFontSize: 11,
  defaultFontColor: 0,
  defaultFontStyle: 'normal',
  lineHeightFactor: 1.35,

  init(doc) {
    this.applyTypography(doc);
  },

  applyTypography(doc, overrides = {}) {
    const font = overrides.font ?? this.defaultFont;
    const fontStyle = overrides.fontStyle ?? this.defaultFontStyle;
    const fontSize = overrides.fontSize ?? this.defaultFontSize;
    const color = overrides.color ?? this.defaultFontColor;

    doc.setFont(font, fontStyle);
    doc.setFontSize(fontSize);
    doc.setLineHeightFactor(this.lineHeightFactor);
    doc.setTextColor(color);
  },

  addPage(doc, options) {
    doc.addPage();
    this.applyTypography(doc, options);
  },

  pageWidth(doc) {
    return doc.internal.pageSize.width;
  },

  pageHeight(doc) {
    return doc.internal.pageSize.height;
  },

  usableWidth(doc, extraPadding = 0) {
    return (
      this.pageWidth(doc) -
      (this.marginLeft + this.marginRight + extraPadding)
    );
  },

  lineHeight(doc, fontSize) {
    const size = fontSize ?? doc.internal.getFontSize();
    return (doc.getLineHeightFactor() * size) / doc.internal.scaleFactor;
  },

  wrap(doc, text, maxWidth) {
    const str = text === undefined || text === null ? '' : String(text);
    const width = maxWidth ?? this.usableWidth(doc);
    return doc.splitTextToSize(str, width);
  },

  drawText(doc, text, x, y, options = {}) {
    if (text === undefined || text === null) {
      return y;
    }

    const {
      maxWidth,
      lineHeight = this.lineHeight(doc, options.fontSize),
      align,
      pagePadding = 20,
      resetY = 30
    } = options;

    const lines = Array.isArray(text) ? text : this.wrap(doc, text, maxWidth);
    let cursor = y;

    lines.forEach(line => {
      cursor = this.ensureSpace(doc, cursor, pagePadding, resetY);
      const target = align ? { align } : undefined;
      doc.text(line, x, cursor, target);
      cursor += lineHeight;
    });

    return cursor;
  },

  drawBulletList(doc, items, x, y, options = {}) {
    const bullet = options.bullet ?? '-';
    const indent = options.indent ?? 4;
    const afterItem = options.afterItem ?? 2;
    const lineHeight = options.lineHeight ?? this.lineHeight(doc);
    const maxWidth =
      options.maxWidth ?? this.usableWidth(doc, indent);
    const pagePadding = options.pagePadding ?? 20;
    const resetY = options.resetY ?? 30;

    let cursor = y;
    (items || []).forEach(item => {
      const content = item ? `${bullet} ${item}` : `${bullet}`;
      const lines = this.wrap(doc, content, maxWidth);
      lines.forEach(line => {
        cursor = this.ensureSpace(doc, cursor, pagePadding, resetY);
        doc.text(line, x, cursor);
        cursor += lineHeight;
      });
      cursor += afterItem;
    });

    return cursor;
  },

  ensureSpace(doc, y, required = 20, resetTo = 30) {
    if (y >= this.pageHeight(doc) - required) {
      this.addPage(doc);
      return resetTo;
    }
    return y;
  }
};

const PdfTypography = {
  documentTitle(doc) {
    PdfLayout.applyTypography(doc, { fontSize: 28, fontStyle: 'bold' });
  },

  pageTitle(doc) {
    PdfLayout.applyTypography(doc, { fontSize: 20, fontStyle: 'normal' });
  },

  sectionTitle(doc) {
    PdfLayout.applyTypography(doc, { fontSize: 18, fontStyle: 'bold' });
  },

  subsectionTitle(doc) {
    PdfLayout.applyTypography(doc, { fontSize: 16, fontStyle: 'bold' });
  },

  heading(doc, style = 'bold') {
    PdfLayout.applyTypography(doc, { fontSize: 14, fontStyle: style });
  },

  label(doc, style = 'bold') {
    PdfLayout.applyTypography(doc, { fontSize: 12, fontStyle: style });
  },

  body(doc, style = 'normal') {
    PdfLayout.applyTypography(doc, {
      fontSize: PdfLayout.defaultFontSize,
      fontStyle: style
    });
  },

  small(doc, style = 'normal') {
    PdfLayout.applyTypography(doc, { fontSize: 10, fontStyle: style });
  }
};

/**
 * Normalize strings before writing to the PDF
 */
const TextSanitizer = {
  clean(value) {
    if (value === undefined || value === null) {
      return '';
    }

    let text = String(value);
    text = this.insertWordBreaks(text);
    text = text
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, '-')
      .replace(/•/g, '-');

    return text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
  },

  insertWordBreaks(text, maxLength = 32) {
    const pattern = new RegExp(`(\\S{${maxLength}})(?=\\S)`, 'g');
    return text.replace(pattern, '$1 ');
  },

  normalize(value) {
    if (Array.isArray(value)) {
      return value.map(item => this.clean(item));
    }
    return this.clean(value);
  }
};

const ExportUtility = {
  /**
   * Generate PDF report
   */
  async generateReport(data) {
    if (!data) {
      throw new Error('No data provided for export');
    }

    // Validate export data
    const validation = Validators.validateExportData(data);
    if (!validation.valid) {
      throw new Error(`Cannot export: ${validation.errors.join(', ')}`);
    }

    try {
      const { jsPDF } = window.jspdf;
      const doc = this.createDocument(jsPDF);

      this.setupDocument(doc);

      // Get venture name (custom name if set, otherwise AI-generated).
      // SmartsheetIntegration.getVentureName() is the canonical resolver in v04
      // (queue name -> #venture-name-text -> AI name). window.app has no such
      // method, so calling it directly throws "is not a function".
      const ventureName =
        (typeof window.SmartsheetIntegration?.getVentureName === 'function'
          ? window.SmartsheetIntegration.getVentureName()
          : null) ||
        data.company?.company_overview?.name ||
        'Company';

      // Store venture name in data for use by page methods
      data.ventureName = ventureName;

      // Set document properties
      doc.setProperties({
        title: 'Venture Assessment Report',
        subject: `Assessment of ${ventureName}`,
        author: 'Venture Assessment Platform',
        keywords: 'venture, assessment, team, competitive, market, ip risk, intellectual property',
        creator: 'Venture Assessment Platform'
      });

      // Add pages
      this.addTitlePage(doc, data);
      PdfLayout.addPage(doc);
      this.addExecutiveSummary(doc, data);
      if (data.team) {
        PdfLayout.addPage(doc);
        this.addTeamAssessment(doc, data);
      }
      if (data.funding) {
        PdfLayout.addPage(doc);
        this.addFundingAssessment(doc, data);
      }
      if (data.competitive) {
        PdfLayout.addPage(doc);
        this.addCompetitiveAssessment(doc, data);
      }
      if (data.market) {
        PdfLayout.addPage(doc);
        this.addMarketAssessment(doc, data);
      }
      if (data.iprisk) {
        PdfLayout.addPage(doc);
        this.addIpRiskAssessment(doc, data);
      }
      if (data.solutionvalue?.userScore) {
        PdfLayout.addPage(doc);
        this.addSolutionValueAssessment(doc, data);
      }

      // Add final recommendation if present
      if (data.finalRecommendation) {
        PdfLayout.addPage(doc);
        this.addFinalRecommendation(doc, data);
      }

      // Add venture-level advisor decisions if any are set
      if (this.hasVentureDecisions(data.ventureDecisions)) {
        PdfLayout.addPage(doc);
        this.addVentureLevelDecisions(doc, data);
      }

      // Add appendix with full data
      PdfLayout.addPage(doc);
      this.addAppendixCover(doc);
      PdfLayout.addPage(doc);
      this.addCompanyDetails(doc, data.company);
      if (data.team) {
        PdfLayout.addPage(doc);
        this.addTeamDetails(doc, data.team);
      }
      if (data.competitive) {
        PdfLayout.addPage(doc);
        this.addCompetitiveDetails(doc, data.competitive);
      }
      if (data.market) {
        PdfLayout.addPage(doc);
        this.addMarketDetails(doc, data.market);
      }
      if (data.iprisk) {
        PdfLayout.addPage(doc);
        this.addIpRiskDetails(doc, data.iprisk);
      }

      // Generate filename
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `assessment_${ventureName.toLowerCase().replace(/\s+/g, '_')}_${timestamp}.pdf`;

      const pdfBlob = doc.output('blob');

      // Save the PDF locally
      doc.save(filename);

      await this.trySharepointUpload(pdfBlob, filename);

      return filename;
    } catch (error) {
      console.error('Export failed:', error);
      throw error;
    }
  },

  createDocument(jsPDF) {
    const doc = new jsPDF();
    this.applyDocGuards(doc);
    return doc;
  },

  applyDocGuards(doc) {
    const originalText = doc.text.bind(doc);
    doc.text = (text, ...rest) => {
      return originalText(TextSanitizer.normalize(text), ...rest);
    };

    const originalSplit = doc.splitTextToSize.bind(doc);
    doc.splitTextToSize = (text, maxWidth, options) => {
      return originalSplit(TextSanitizer.clean(text), maxWidth, options);
    };

    const originalSetFont = doc.setFont.bind(doc);
    doc.setFont = (fontName, fontStyle = PdfLayout.defaultFontStyle) => {
      const resolvedFont = fontName || PdfLayout.defaultFont;
      const resolvedStyle = fontStyle || PdfLayout.defaultFontStyle;
      return originalSetFont(resolvedFont, resolvedStyle);
    };
  },

  /**
   * Apply baseline typography and spacing defaults to the document.
   */
  setupDocument(doc) {
    PdfLayout.init(doc);
  },

  async trySharepointUpload(blob, filename) {
    if (!blob || typeof window === 'undefined') {
      return;
    }

    const uploader = window.SharepointUploader;
    if (!uploader || typeof uploader.uploadFile !== 'function') {
      return;
    }

    const shouldUpload =
      typeof uploader.isEnabled === 'function' ? uploader.isEnabled() : true;

    if (!shouldUpload) {
      return;
    }

    try {
      await uploader.uploadFile(blob, filename);
    } catch (error) {
      if (typeof uploader.handleError === 'function') {
        uploader.handleError(error);
      } else {
        console.error('SharePoint upload failed:', error);
      }
    }
  },

  /**
   * Add title page
   */
  addTitlePage(doc, data) {
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;

  // Title
  PdfTypography.documentTitle(doc);
  doc.text('Venture Assessment Report', pageWidth / 2, 60, { align: 'center' });

  // Company name (use custom name if set)
  PdfTypography.pageTitle(doc);
  const companyName = data.ventureName || data.company.company_overview?.name || 'Unknown Company';
  doc.text(companyName, pageWidth / 2, 80, { align: 'center' });

  // SCA Name
  const scaName = document.getElementById('scaName')?.value || 'Not specified';
  PdfTypography.label(doc, 'normal');
  doc.text(`Assessed by: ${scaName}`, pageWidth / 2, 95, { align: 'center' });

  // Date
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  PdfTypography.body(doc);
  doc.text(date, pageWidth / 2, 105, { align: 'center' });

  // Rest of the method continues...

  // Scores box
    const boxY = 120;
    const boxX = 30;
    const boxWidth = pageWidth - 60;
    const contentPadding = 18;

    const formatScore = (score) => (score === undefined || score === null ? '-' : `${score}/9`);
    const scoreRows = [
      {
        title: 'Researcher Aptitude',
        ai: formatScore(data.team?.score),
        user: formatScore(data.team?.userScore)
      },
      {
        title: 'Sector Funding Activity',
        ai: formatScore(data.funding?.score),
        user: formatScore(data.funding?.userScore)
      },
      {
        title: 'Competitive Winnability',
        ai: formatScore(data.competitive?.assessment?.score),
        user: formatScore(data.competitive?.userScore)
      },
      {
        title: 'Market Opportunity',
        ai: formatScore(data.market?.scoring?.score),
        user: formatScore(data.market?.userScore)
      },
      {
        title: 'IP Landscape',
        ai: formatScore(data.iprisk?.score),
        user: formatScore(data.iprisk?.userScore)
      },
      {
        title: 'Solution Value',
        ai: '-',
        user: formatScore(data.solutionvalue?.userScore)
      }
    ];

    const leftColumnX = boxX + 15;
    const rightColumnX = pageWidth / 2 + 15;
    const lineHeight = PdfLayout.lineHeight(doc, 11);
    const dimensionColumnWidth = (pageWidth / 2) - boxX - 25;
    const scoreColumnWidth = boxX + boxWidth - rightColumnX - 10;

    const measuredRows = scoreRows.map(row => {
      const titleLines = doc.splitTextToSize(row.title, dimensionColumnWidth);
      const scoreLabel = `AI: ${row.ai}   User: ${row.user}`;
      const scoreLines = doc.splitTextToSize(scoreLabel, scoreColumnWidth);
      const height = Math.max(titleLines.length, scoreLines.length) * lineHeight;
      return { ...row, titleLines, scoreLines, height };
    });

    const headerHeight = lineHeight;
    const tableHeight =
      contentPadding * 2 +
      headerHeight +
      measuredRows.reduce((sum, row) => sum + row.height, 0);

    doc.setDrawColor(102, 126, 234);
    doc.setLineWidth(1);
    doc.rect(boxX, boxY, boxWidth, tableHeight);

    PdfTypography.subsectionTitle(doc);
    doc.text('Assessment Results', pageWidth / 2, boxY + 18, { align: 'center' });

    let rowY = boxY + 32;

    PdfTypography.label(doc);
    doc.text('Dimension', leftColumnX, rowY);
    doc.text('Scores (AI | User)', rightColumnX, rowY);
    rowY += lineHeight;
    PdfTypography.body(doc);

    measuredRows.forEach(row => {
      const maxLines = Math.max(row.titleLines.length, row.scoreLines.length);
      for (let i = 0; i < maxLines; i += 1) {
        const titleLine = row.titleLines[i];
        const scoreLine = row.scoreLines[i];
        if (titleLine) {
          doc.text(titleLine, leftColumnX, rowY);
        }
        if (scoreLine) {
          doc.text(scoreLine, rightColumnX, rowY);
        }
        rowY += lineHeight;
      }
    });

    // Footer
    PdfTypography.small(doc);
    doc.setTextColor(128);
    doc.text('Generated by Venture Assessment Platform', pageWidth / 2, pageHeight - 20, { align: 'center' });
    doc.setTextColor(PdfLayout.defaultFontColor);
    PdfTypography.body(doc);
  },

  /**
   * Add executive summary
   */
  addExecutiveSummary(doc, data) {
    const pageWidth = doc.internal.pageSize.width;
    const contentWidth = pageWidth - PdfLayout.marginLeft - PdfLayout.marginRight;
    let y = 30;

    const bulletOptions = {
      bullet: '-',
      lineHeight: PdfLayout.lineHeight(doc),
      maxWidth: contentWidth,
      afterItem: 1
    };

    const addHeading = (title, spacing = 10) => {
      y = PdfLayout.ensureSpace(doc, y, 25);
      PdfTypography.heading(doc);
      doc.text(title, PdfLayout.marginLeft, y);
      y += spacing;
      PdfTypography.body(doc);
    };

    PdfTypography.sectionTitle(doc);
    doc.text('Executive Summary', PdfLayout.marginLeft, y);
    y += 15;

    addHeading('Company Overview');
    const overview = data.company?.company_overview || {};
    y = PdfLayout.drawText(
      doc,
      overview.one_liner || overview.detailed_description || overview.downstream_summary || 'No description available',
      PdfLayout.marginLeft,
      y,
      { maxWidth: contentWidth }
    );
    y += 8;

    addHeading('Key Metrics');
    const competitive = data.competitive?.formatted || {};
    const funding = data.funding?.formatted || {};
    const market = data.market?.formatted || {};
    const primaryMarket = market.primaryMarket || {};
    const iprisk = data.iprisk?.formatted || {};

    const metricSections = [
      {
        title: 'Competitive Winnability',
        items: [
          `Total Competitors: ${competitive.totalCompetitors ?? '-'}`,
          `Competitive Intensity: ${Formatters.competitiveIntensity(competitive.competitiveIntensity)}`,
          `Market Leaders: ${(competitive.marketLeaders || []).length}`
        ]
      },
      {
        title: 'Sector Funding Activity',
        items: [
          `Activity Level: ${Formatters.titleCase(funding.activityLevel || 'Unknown')}`,
          `Verified Deals: ${funding.totalVerifiedDeals ?? 0}`,
          `Funding Trend: ${Formatters.titleCase(funding.fundingTrend || 'Unknown')}`,
          `Data Reliability: ${Formatters.titleCase(funding.dataReliability || 'Unknown')}`
        ]
      },
      {
        title: 'Market',
        items: [
          `Total Addressable Market: ${Formatters.currency(primaryMarket.tam)}`,
          `Growth Rate (CAGR): ${Formatters.percentage(primaryMarket.cagr)}`
        ]
      },
      {
        title: 'IP Landscape',
        items: [
          `Overall Risk: ${Formatters.titleCase(iprisk.overallRisk || 'Unknown')}`,
          `Freedom to Operate: ${Formatters.titleCase(iprisk.freedomToOperate || 'Unknown')}`,
          `Patent Density: ${Formatters.titleCase(iprisk.patentDensity || 'Unknown')}`,
          `Data Confidence: ${iprisk.dataConfidence || 'Unknown'}`
        ]
      }
    ];

    metricSections.forEach(section => {
      const items = section.items.filter(Boolean);
      if (!items.length) return;
      y = PdfLayout.ensureSpace(doc, y, 30);
      PdfTypography.body(doc, 'bold');
      doc.text(`${section.title}:`, PdfLayout.marginLeft, y);
      y += 6;
      PdfTypography.body(doc);
      y = PdfLayout.drawBulletList(
        doc,
        items,
        PdfLayout.marginLeft,
        y,
        bulletOptions
      );
      y += 6;
    });

    addHeading('Assessment Summary');
    const teamFormatted = data.team?.formatted || {};
    const teamComposition = teamFormatted.teamComposition || {};
    const teamMembersCount = teamComposition.total ?? (teamFormatted.members?.length ?? '-');
    const teamStrengthsText = (teamFormatted.strengths || []).slice(0, 2).join('; ') || 'Not specified';
    const teamGapsText = (teamFormatted.gaps || []).slice(0, 2).join('; ') || 'Not specified';
    const teamConfidence = teamFormatted.confidence !== undefined && teamFormatted.confidence !== null
      ? Formatters.confidence(teamFormatted.confidence)
      : 'Not available';

    y = PdfLayout.drawBulletList(
      doc,
      [
        `Team Size: ${teamMembersCount}`,
        `Technical Experts: ${teamComposition.technical ?? 0} | Business Leaders: ${teamComposition.business ?? 0}`,
        `Researcher Aptitude Confidence: ${teamConfidence}`
      ],
      PdfLayout.marginLeft,
      y,
      bulletOptions
    );
    y = PdfLayout.drawBulletList(
      doc,
      [
        `Key Strengths: ${teamStrengthsText}`,
        `Key Gaps: ${teamGapsText}`
      ],
      PdfLayout.marginLeft,
      y,
      bulletOptions
    );
    y += 6;

    const fundingSummary = [
      `Activity Level: ${Formatters.titleCase(funding.activityLevel || 'Unknown')}`,
      `Verified Deals: ${funding.totalVerifiedDeals ?? 0}`,
      `Data Reliability: ${Formatters.titleCase(funding.dataReliability || 'Unknown')}`
    ];
    y = PdfLayout.drawBulletList(
      doc,
      fundingSummary,
      PdfLayout.marginLeft,
      y,
      bulletOptions
    );
    y += 4;

    const aiScores = [
      data.team?.score,
      data.funding?.score,
      data.competitive?.assessment?.score,
      data.market?.scoring?.score,
      data.iprisk?.score
    ].filter(score => score !== undefined && score !== null);

    const userScores = [
      data.team?.userScore,
      data.funding?.userScore,
      data.competitive?.userScore,
      data.market?.userScore,
      data.iprisk?.userScore,
      data.solutionvalue?.userScore
    ].filter(score => score !== undefined && score !== null);

    const avgAiScore = aiScores.length
      ? aiScores.reduce((sum, value) => sum + value, 0) / aiScores.length
      : null;
    const avgUserScore = userScores.length
      ? userScores.reduce((sum, value) => sum + value, 0) / userScores.length
      : null;

    y = PdfLayout.drawText(
      doc,
      `Average AI Score: ${avgAiScore !== null ? `${avgAiScore.toFixed(1)}/9` : '-'}`,
      PdfLayout.marginLeft,
      y,
      { maxWidth: contentWidth }
    );
    y = PdfLayout.drawText(
      doc,
      `Average User Score: ${avgUserScore !== null ? `${avgUserScore.toFixed(1)}/9` : '-'}`,
      PdfLayout.marginLeft,
      y,
      { maxWidth: contentWidth }
    );
  },
  /**
   * Add team assessment page
   */
  addTeamAssessment(doc, data) {
    const pageWidth = doc.internal.pageSize.width;
    const contentWidth = pageWidth - PdfLayout.marginLeft - PdfLayout.marginRight;
    let y = 30;

    PdfTypography.sectionTitle(doc);
    doc.text('Researcher Aptitude Assessment', PdfLayout.marginLeft, y);
    y += 15;

    if (!data.team) {
      PdfTypography.body(doc);
      doc.text('Team assessment data not available.', PdfLayout.marginLeft, y);
      return;
    }

    const ensureSpace = (padding = 20) => {
      y = PdfLayout.ensureSpace(doc, y, padding);
    };

    const bulletOptions = {
      bullet: '-',
      lineHeight: PdfLayout.lineHeight(doc),
      maxWidth: contentWidth,
      afterItem: 1
    };

    const team = data.team;
    const formatted = team.formatted || {};
    const composition = formatted.teamComposition || {};
    const members = formatted.members || [];
    const strengths = formatted.strengths || [];
    const gaps = formatted.gaps || [];
    const experiences = formatted.experiences || [];

    PdfTypography.body(doc);
    doc.text(`AI Score: ${team.score ?? '-'}/9`, PdfLayout.marginLeft, y);
    doc.text(
      `User Score: ${team.userScore ?? '-'}/9`,
      PdfLayout.marginLeft + 75,
      y
    );
    y += 10;

    if (team.userJustification) {
      ensureSpace(30);
      doc.setFont(undefined, 'bold');
      doc.text('User Justification:', PdfLayout.marginLeft, y);
      y += 7;

      doc.setFont(undefined, 'normal');
      y = PdfLayout.drawText(
        doc,
        team.userJustification,
        PdfLayout.marginLeft,
        y,
        { maxWidth: contentWidth }
      );
      y += 4;
    }

    // Composition summary
    ensureSpace(35);
    doc.setFont(undefined, 'bold');
    doc.text('Team Composition', PdfLayout.marginLeft, y);
    y += 8;

    doc.setFont(undefined, 'normal');
    y = PdfLayout.drawBulletList(
      doc,
      [
        `Total Members: ${composition.total ?? members.length}`,
        `Technical Experts: ${composition.technical ?? 0}`,
        `Business Leaders: ${composition.business ?? 0}`
      ],
      PdfLayout.marginLeft,
      y,
      bulletOptions
    );
    y += 6;

    const renderListSection = (title, items, maxItems = 5) => {
      ensureSpace(30);
      doc.setFont(undefined, 'bold');
      doc.text(title, PdfLayout.marginLeft, y);
      y += 8;

      doc.setFont(undefined, 'normal');
      if (!items || items.length === 0) {
        y = PdfLayout.drawBulletList(
          doc,
          ['None noted.'],
          PdfLayout.marginLeft,
          y,
          bulletOptions
        );
        y += 4;
        return;
      }

      items.slice(0, maxItems).forEach(item => {
        const text = typeof item === 'string' ? item : JSON.stringify(item);
        y = PdfLayout.drawBulletList(
          doc,
          [text],
          PdfLayout.marginLeft,
          y,
          bulletOptions
        );
      });

      if (items.length > maxItems) {
        y = PdfLayout.drawText(
          doc,
          `...and ${items.length - maxItems} more`,
          PdfLayout.marginLeft,
          y,
          { maxWidth: contentWidth }
        );
        y += 4;
      } else {
        y += 4;
      }
    };

    renderListSection('Key Strengths', strengths);
    renderListSection('Key Gaps', gaps);
    renderListSection('Relevant Experience Highlights', experiences, 6);

    // Key members
    ensureSpace(35);
    doc.setFont(undefined, 'bold');
    doc.text('Key Team Members', PdfLayout.marginLeft, y);
    y += 8;

    doc.setFont(undefined, 'normal');
    if (members.length === 0) {
      y = PdfLayout.drawBulletList(
        doc,
        ['No team members listed.'],
        PdfLayout.marginLeft,
        y,
        bulletOptions
      );
      y += 4;
    } else {
      const summarizeEntry = (value) => {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'object') {
          const parts = [];
          Object.keys(value).forEach(key => {
            const v = value[key];
            if (v) parts.push(String(v));
          });
          return parts.join(' ');
        }
        return String(value);
      };

      const writeDetail = (label, value) => {
        if (!value) return;
        ensureSpace(15);
        y = PdfLayout.drawText(
          doc,
          `${label}: ${value}`,
          PdfLayout.marginLeft,
          y,
          { maxWidth: contentWidth }
        );
        y += 4;
      };

      members.slice(0, 4).forEach(member => {
        ensureSpace(40);
        doc.setFont(undefined, 'bold');
        doc.text(member.name || 'Team Member', PdfLayout.marginLeft, y);
        y += 7;

        doc.setFont(undefined, 'normal');
        if (member.role_at_venture) {
          writeDetail('Role', member.role_at_venture);
        }

        const commercial = Array.isArray(member.commercialization_experience)
          ? member.commercialization_experience.map(summarizeEntry).filter(Boolean)
          : [];
        writeDetail('Commercial Experience', commercial[0]);

        const education = Array.isArray(member.education_history)
          ? member.education_history.map(summarizeEntry).filter(Boolean)
          : [];
        writeDetail('Education Highlight', education[0]);

        y += 6;
      });

      if (members.length > 4) {
        y = PdfLayout.drawText(
          doc,
          `...and ${members.length - 4} additional team members`,
          PdfLayout.marginLeft,
          y,
          { maxWidth: contentWidth }
        );
        y += 4;
      }
    }

    // Sources
    const sources = formatted.sources || [];
    if (sources.length > 0) {
      ensureSpace(25);
      doc.setFont(undefined, 'bold');
      doc.text('Primary Sources', PdfLayout.marginLeft, y);
      y += 8;

      doc.setFont(undefined, 'normal');
      y = PdfLayout.drawBulletList(
        doc,
        sources.slice(0, 5),
        PdfLayout.marginLeft,
        y,
        bulletOptions
      );

      if (sources.length > 5) {
        y = PdfLayout.drawText(
          doc,
          `...and ${sources.length - 5} more`,
          PdfLayout.marginLeft,
          y,
          { maxWidth: contentWidth }
        );
        y += 4;
      }
    }
  },

  /**
   * Add funding assessment page
   */
  addFundingAssessment(doc, data) {
    const pageWidth = doc.internal.pageSize.width;
    const contentWidth = pageWidth - PdfLayout.marginLeft - PdfLayout.marginRight;
    let y = 30;

    const bulletOptions = {
      bullet: '-',
      lineHeight: PdfLayout.lineHeight(doc),
      maxWidth: contentWidth,
      afterItem: 1
    };

    PdfTypography.sectionTitle(doc);
    doc.text('Sector Funding Activity Assessment', PdfLayout.marginLeft, y);
    y += 15;

    if (!data.funding) {
      PdfTypography.body(doc);
      doc.text('Funding assessment data not available.', PdfLayout.marginLeft, y);
      return;
    }

    const funding = data.funding;
    const formatted = funding.formatted || {};

    PdfTypography.body(doc);
    const aiScore = funding.funding_score ?? funding.score ?? '-';
    doc.text(`AI Score: ${aiScore}/9`, PdfLayout.marginLeft, y);
    doc.text(`User Score: ${funding.userScore ?? '-'}/9`, PdfLayout.marginLeft + 75, y);
    y += 10;

    // User justification
    if (funding.userJustification) {
      y = PdfLayout.ensureSpace(doc, y, 30);
      doc.setFont(undefined, 'bold');
      doc.text('User Justification:', PdfLayout.marginLeft, y);
      y += 7;

      doc.setFont(undefined, 'normal');
      y = PdfLayout.drawText(
        doc,
        funding.userJustification,
        PdfLayout.marginLeft,
        y,
        { maxWidth: contentWidth }
      );
      y += 6;
    }

    // AI Assessment / Score justification
    const scoreJustification = funding.score_justification || formatted.scoreJustification || formatted.narrativeSummary;
    if (scoreJustification) {
      doc.setFont(undefined, 'bold');
      doc.text('AI Assessment:', PdfLayout.marginLeft, y);
      y += 7;

      doc.setFont(undefined, 'normal');
      y = PdfLayout.drawText(
        doc,
        scoreJustification,
        PdfLayout.marginLeft,
        y,
        { maxWidth: contentWidth }
      );
      y += 8;
    }

    // Funding summary
    y = PdfLayout.ensureSpace(doc, y, 30);
    doc.setFont(undefined, 'bold');
    doc.text('Funding Summary:', PdfLayout.marginLeft, y);
    y += 7;

    doc.setFont(undefined, 'normal');

    y = PdfLayout.drawBulletList(
      doc,
      [
        `Activity Level: ${Formatters.titleCase(formatted.activityLevel || 'Unknown')}`,
        `Verified Deals: ${formatted.totalVerifiedDeals ?? 0}`,
        `Funding Trend: ${Formatters.titleCase(formatted.fundingTrend || 'Unknown')}`,
        `Data Reliability: ${Formatters.titleCase(formatted.dataReliability || 'Unknown')}`
      ],
      PdfLayout.marginLeft,
      y,
      bulletOptions
    );
    y += 6;

    // Human review flags
    const considerations = formatted.humanReviewFlags || formatted.keyConsiderations || funding.key_considerations || [];
    if (considerations.length > 0) {
      y = PdfLayout.ensureSpace(doc, y, 30);
      doc.setFont(undefined, 'bold');
      doc.text('Key Considerations:', PdfLayout.marginLeft, y);
      y += 7;

      doc.setFont(undefined, 'normal');
      y = PdfLayout.drawBulletList(
        doc,
        considerations.slice(0, 5),
        PdfLayout.marginLeft,
        y,
        bulletOptions
      );
    }
  },

  /**
   * Add competitive assessment page
   */
  addCompetitiveAssessment(doc, data) {
    const pageWidth = doc.internal.pageSize.width;
    const contentWidth = pageWidth - PdfLayout.marginLeft - PdfLayout.marginRight;
    let y = 30;

    const bulletOptions = {
      bullet: '-',
      lineHeight: PdfLayout.lineHeight(doc),
      maxWidth: contentWidth,
      afterItem: 1
    };

    PdfTypography.sectionTitle(doc);
    doc.text('Competitive Winnability Assessment', PdfLayout.marginLeft, y);
    y += 15;

    PdfTypography.body(doc);
    doc.text(`AI Score: ${data.competitive.assessment.score}/9`, PdfLayout.marginLeft, y);
    doc.text(`User Score: ${data.competitive.userScore}/9`, PdfLayout.marginLeft + 75, y);
    y += 10;

    if (data.competitive.userJustification) {
      y = PdfLayout.ensureSpace(doc, y, 30);
      doc.setFont(undefined, 'bold');
      doc.text('User Justification:', PdfLayout.marginLeft, y);
      y += 7;

      doc.setFont(undefined, 'normal');
      y = PdfLayout.drawText(
        doc,
        data.competitive.userJustification,
        PdfLayout.marginLeft,
        y,
        { maxWidth: contentWidth }
      );
      y += 6;
    }

    doc.setFont(undefined, 'bold');
    doc.text('AI Assessment:', PdfLayout.marginLeft, y);
    y += 7;

    doc.setFont(undefined, 'normal');
    y = PdfLayout.drawText(
      doc,
      data.competitive.assessment.score_justification || 'No justification provided',
      PdfLayout.marginLeft,
      y,
      { maxWidth: contentWidth }
    );
    y += 8;

    const risks = data.competitive.assessment.key_risk_factors || [];
    if (risks.length > 0) {
      y = PdfLayout.ensureSpace(doc, y, 30);
      doc.setFont(undefined, 'bold');
      doc.text('Key Risks:', PdfLayout.marginLeft, y);
      y += 7;

      doc.setFont(undefined, 'normal');
      y = PdfLayout.drawBulletList(
        doc,
        risks.slice(0, 5),
        PdfLayout.marginLeft,
        y,
        bulletOptions
      );
    }
  },
  /**
   * Add market assessment page
   */
  addMarketAssessment(doc, data) {
    const pageWidth = doc.internal.pageSize.width;
    const contentWidth = pageWidth - PdfLayout.marginLeft - PdfLayout.marginRight;
    let y = 30;

    const bulletOptions = {
      bullet: '-',
      lineHeight: PdfLayout.lineHeight(doc),
      maxWidth: contentWidth,
      afterItem: 1
    };

    PdfTypography.sectionTitle(doc);
    doc.text('Market Opportunity Assessment', PdfLayout.marginLeft, y);
    y += 15;

    PdfTypography.body(doc);
    doc.text(`AI Score: ${data.market.scoring.score}/9`, PdfLayout.marginLeft, y);
    doc.text(`User Score: ${data.market.userScore}/9`, PdfLayout.marginLeft + 75, y);
    y += 10;

    if (data.market.userJustification) {
      y = PdfLayout.ensureSpace(doc, y, 30);
      doc.setFont(undefined, 'bold');
      doc.text('User Justification:', PdfLayout.marginLeft, y);
      y += 7;

      doc.setFont(undefined, 'normal');
      y = PdfLayout.drawText(
        doc,
        data.market.userJustification,
        PdfLayout.marginLeft,
        y,
        { maxWidth: contentWidth }
      );
      y += 6;
    }

    doc.setFont(undefined, 'bold');
    doc.text('AI Assessment:', PdfLayout.marginLeft, y);
    y += 7;

    doc.setFont(undefined, 'normal');
    y = PdfLayout.drawText(
      doc,
      (typeof data.market.scoring.justification === 'string' ? data.market.scoring.justification : data.market.scoring.justification?.summary) || data.market.formatted?.justification || 'No justification provided',
      PdfLayout.marginLeft,
      y,
      { maxWidth: contentWidth }
    );
    y += 8;

    doc.setFont(undefined, 'bold');
    doc.text('Primary Market:', PdfLayout.marginLeft, y);
    y += 7;

    doc.setFont(undefined, 'normal');
    const primaryMarket = data.market.analysis.primary_market || {};
    y = PdfLayout.drawBulletList(
      doc,
      [
        `TAM: ${Formatters.currency(primaryMarket.tam_usd)}`,
        `CAGR: ${Formatters.percentage(primaryMarket.cagr_percent)}`,
        primaryMarket.description ? `Description: ${primaryMarket.description}` : null
      ].filter(Boolean),
      PdfLayout.marginLeft,
      y,
      bulletOptions
    );
  },
  /**
   * Add IP risk assessment page
   */
  addIpRiskAssessment(doc, data) {
    const pageWidth = doc.internal.pageSize.width;
    const contentWidth = pageWidth - PdfLayout.marginLeft - PdfLayout.marginRight;
    let y = 30;

    const bulletOptions = {
      bullet: '-',
      lineHeight: PdfLayout.lineHeight(doc),
      maxWidth: contentWidth,
      afterItem: 1
    };

    const iprisk = data.iprisk;
    const formatted = iprisk.formatted || {};

    const ensureSpace = (padding = 20) => {
      y = PdfLayout.ensureSpace(doc, y, padding);
    };

    const renderParagraph = (text) => {
      const content = text || 'No information provided.';
      ensureSpace(20);
      y = PdfLayout.drawText(
        doc,
        content,
        PdfLayout.marginLeft,
        y,
        { maxWidth: contentWidth }
      );
      y += 6;
    };

    const renderList = (title, items, limit = 8) => {
      ensureSpace(25);
      doc.setFont(undefined, 'bold');
      doc.text(title, PdfLayout.marginLeft, y);
      y += 7;

      doc.setFont(undefined, 'normal');
      if (!items || items.length === 0) {
        y = PdfLayout.drawBulletList(
          doc,
          ['None noted'],
          PdfLayout.marginLeft,
          y,
          bulletOptions
        );
        y += 4;
        return;
      }

      y = PdfLayout.drawBulletList(
        doc,
        items.slice(0, limit),
        PdfLayout.marginLeft,
        y,
        bulletOptions
      );

      if (items.length > limit) {
        y = PdfLayout.drawText(
          doc,
          `...and ${items.length - limit} more`,
          PdfLayout.marginLeft,
          y,
          { maxWidth: contentWidth }
        );
        y += 4;
      }
    };

    PdfTypography.sectionTitle(doc);
    doc.text('IP Landscape Assessment', PdfLayout.marginLeft, y);
    y += 15;

    PdfTypography.body(doc);
    doc.text(`AI Score: ${iprisk.score ?? '-'}/9`, PdfLayout.marginLeft, y);
    doc.text(`User Score: ${iprisk.userScore ?? '-'}/9`, PdfLayout.marginLeft + 75, y);
    y += 10;

    y = PdfLayout.drawBulletList(
      doc,
      [
        `Overall Risk: ${Formatters.titleCase(formatted.overallRisk || 'Unknown')}`,
        `Freedom to Operate: ${Formatters.titleCase(formatted.freedomToOperate || 'Unknown')}`,
        `Patent Density: ${Formatters.titleCase(formatted.patentDensity || 'Unknown')}`,
        `Data Confidence: ${formatted.dataConfidence || 'Unknown'}`
      ],
      PdfLayout.marginLeft,
      y,
      bulletOptions
    );
    y += 4;

    if (iprisk.userJustification) {
      doc.setFont(undefined, 'bold');
      doc.text('User Justification:', PdfLayout.marginLeft, y);
      y += 7;
      doc.setFont(undefined, 'normal');
      renderParagraph(iprisk.userJustification);
    }

    doc.setFont(undefined, 'bold');
    doc.text('Company IP Position:', PdfLayout.marginLeft, y);
    y += 7;
    doc.setFont(undefined, 'normal');
    renderParagraph(formatted.companyIP?.summary || formatted.companyIP?.description || formatted.companyCurrentIP?.description);

    doc.setFont(undefined, 'bold');
    doc.text('AI Assessment:', PdfLayout.marginLeft, y);
    y += 7;
    doc.setFont(undefined, 'normal');
    renderParagraph(formatted.riskAnalysis);

    renderList('Key IP Challenges', formatted.challenges || []);
    renderList('Unique Protectable Features', formatted.uniqueFeatures || []);
    renderList('Crowded Feature Areas', formatted.crowdedFeatures || []);
  },

  /**
   * Add solution value assessment page
   */
  addSolutionValueAssessment(doc, data) {
    const pageWidth = doc.internal.pageSize.width;
    const contentWidth = pageWidth - PdfLayout.marginLeft - PdfLayout.marginRight;
    let y = 30;

    const bulletOptions = {
      bullet: '-',
      lineHeight: PdfLayout.lineHeight(doc),
      maxWidth: contentWidth,
      afterItem: 1
    };

    PdfTypography.sectionTitle(doc);
    doc.text('Solution Value Assessment', PdfLayout.marginLeft, y);
    y += 15;

    PdfTypography.body(doc);
    doc.text('AI Score: N/A (User-Scored Only)', PdfLayout.marginLeft, y);
    doc.text(`User Score: ${data.solutionvalue?.userScore ?? '-'}/9`, PdfLayout.marginLeft + 100, y);
    y += 10;

    if (data.solutionvalue?.userJustification) {
      y = PdfLayout.ensureSpace(doc, y, 30);
      doc.setFont(undefined, 'bold');
      doc.text('User Justification:', PdfLayout.marginLeft, y);
      y += 7;

      doc.setFont(undefined, 'normal');
      y = PdfLayout.drawText(
        doc,
        data.solutionvalue.userJustification,
        PdfLayout.marginLeft,
        y,
        { maxWidth: contentWidth }
      );
      y += 6;
    }

    // Supporting evidence from other analyses
    y = PdfLayout.ensureSpace(doc, y, 30);
    doc.setFont(undefined, 'bold');
    doc.text('Supporting Evidence:', PdfLayout.marginLeft, y);
    y += 10;

    // Sections organized around the Solution Value rubric:
    // (a) magnitude of benefit vs. alternatives, (b) acuteness of unmet need.
    const company = data.company || {};
    const solutionValue = company.solution_value || {};

    const gapTypeLabels = {
      no_solution: 'No solution exists',
      partial_solution: 'Partial solution',
      inadequate_solution: 'Inadequate solution',
      aspirational_only: 'Aspirational only'
    };

    // The Unmet Need (problem + severity + gap type)
    const una = solutionValue.unmet_need_assessment || {};
    if (solutionValue.problem_statement || solutionValue.problem_severity || una.gap_type) {
      doc.setFont(undefined, 'bold');
      doc.text('The Unmet Need:', PdfLayout.marginLeft, y);
      y += 7;
      doc.setFont(undefined, 'normal');
      const items = [];
      if (solutionValue.problem_statement) items.push(`Problem: ${solutionValue.problem_statement}`);
      if (solutionValue.problem_severity) {
        const sev = solutionValue.problem_severity;
        const sevLine = solutionValue.problem_severity_justification
          ? `Severity (${sev}): ${solutionValue.problem_severity_justification}`
          : `Severity: ${sev}`;
        items.push(sevLine);
      }
      if (una.gap_type) {
        const gapLabel = gapTypeLabels[una.gap_type] || una.gap_type;
        const gapLine = una.current_coverage
          ? `Need is currently: ${gapLabel} — ${una.current_coverage}`
          : `Need is currently: ${gapLabel}`;
        items.push(gapLine);
      }
      const limitations = solutionValue.status_quo_limitations || [];
      limitations.slice(0, 3).forEach(l => items.push(`Status quo limitation: ${l}`));
      y = PdfLayout.drawBulletList(doc, items, PdfLayout.marginLeft, y, bulletOptions);
      y += 6;
    }

    // Beachhead Customer
    const beachhead = solutionValue.beachhead_customer || {};
    if (beachhead.segment) {
      y = PdfLayout.ensureSpace(doc, y, 20);
      doc.setFont(undefined, 'bold');
      doc.text('Beachhead Customer:', PdfLayout.marginLeft, y);
      y += 7;
      doc.setFont(undefined, 'normal');
      const items = [`Segment: ${beachhead.segment}${beachhead.evidence_quality ? ` (${beachhead.evidence_quality})` : ''}`];
      if (beachhead.why_acute) items.push(`Why acute: ${beachhead.why_acute}`);
      y = PdfLayout.drawBulletList(doc, items, PdfLayout.marginLeft, y, bulletOptions);
      y += 6;
    }

    // Quantified Benefits vs. Alternatives
    const benefits = solutionValue.benefit_magnitude || [];
    if (solutionValue.value_proposition || benefits.length) {
      y = PdfLayout.ensureSpace(doc, y, 25);
      doc.setFont(undefined, 'bold');
      doc.text('Magnitude of Benefit vs. Alternatives:', PdfLayout.marginLeft, y);
      y += 7;
      doc.setFont(undefined, 'normal');
      const items = [];
      if (solutionValue.value_proposition) items.push(`Value proposition: ${solutionValue.value_proposition}`);
      benefits.slice(0, 5).forEach(b => {
        const metric = b.metric || '?';
        const baseline = b.baseline || '?';
        const delta = b.delta || '?';
        const source = b.evidence_source ? ` [${b.evidence_source}` : '';
        const quality = b.evidence_quality ? `${source ? ', ' : ' ['}${b.evidence_quality}]` : (source ? ']' : '');
        items.push(`${metric} — vs ${baseline}: ${delta}${source}${quality}`);
      });
      y = PdfLayout.drawBulletList(doc, items, PdfLayout.marginLeft, y, bulletOptions);
      y += 6;
    }

    // Market Needs (compressed to 2 bullets)
    const market = data.market || {};
    const marketFormatted = market.formatted || {};
    if (marketFormatted.unmetNeeds?.length || marketFormatted.problemStatement || marketFormatted.differentiation) {
      y = PdfLayout.ensureSpace(doc, y, 25);
      doc.setFont(undefined, 'bold');
      doc.text('Market Needs & Differentiation:', PdfLayout.marginLeft, y);
      y += 7;
      doc.setFont(undefined, 'normal');
      const items = [];
      if (marketFormatted.problemStatement) items.push(`Problem: ${marketFormatted.problemStatement}`);
      if (marketFormatted.differentiation) items.push(`Differentiation: ${marketFormatted.differentiation}`);
      if (marketFormatted.unmetNeeds?.length) {
        marketFormatted.unmetNeeds.slice(0, 2).forEach(need => items.push(`Unmet Need: ${need}`));
      }
      y = PdfLayout.drawBulletList(doc, items.slice(0, 2), PdfLayout.marginLeft, y, bulletOptions);
      y += 6;
    }

    // Competitive Gaps (compressed to 2 bullets)
    const competitive = data.competitive || {};
    const compAnalysis = competitive.analysis || {};
    const compAssessment = competitive.assessment || {};
    const marketGaps = compAnalysis.market_gaps || compAnalysis.competitive_analysis?.market_gaps || [];
    const diffOpps = compAssessment.differentiation_opportunities || [];
    if (marketGaps.length || diffOpps.length) {
      y = PdfLayout.ensureSpace(doc, y, 25);
      doc.setFont(undefined, 'bold');
      doc.text('Competitive Gaps & Opportunities:', PdfLayout.marginLeft, y);
      y += 7;
      doc.setFont(undefined, 'normal');
      const items = [];
      if (marketGaps.length) items.push(`Gap: ${marketGaps[0]}`);
      if (diffOpps.length) items.push(`Opportunity: ${diffOpps[0]}`);
      y = PdfLayout.drawBulletList(doc, items, PdfLayout.marginLeft, y, bulletOptions);
    }
  },

  /**
   * Add final recommendation page
   */
  addFinalRecommendation(doc, data) {
    const pageWidth = doc.internal.pageSize.width;
    const contentWidth = pageWidth - PdfLayout.marginLeft - PdfLayout.marginRight;
    let y = 30;

    PdfTypography.sectionTitle(doc);
    doc.text('Final Recommendation', PdfLayout.marginLeft, y);
    y += 15;

    // Get advisor name
    const advisorName = document.getElementById('sca-name')?.value ||
      window.app?.stateManager?.getState()?.scaName ||
      'Advisor';

    PdfTypography.body(doc, 'bold');
    doc.text(`Submitted by: ${advisorName}`, PdfLayout.marginLeft, y);
    y += 10;

    PdfTypography.body(doc);
    y = PdfLayout.drawText(
      doc,
      data.finalRecommendation,
      PdfLayout.marginLeft,
      y,
      { maxWidth: contentWidth }
    );
  },

  /**
   * Whether any Venture-Level Advisor Decisions are set.
   */
  hasVentureDecisions(vd) {
    if (!vd) return false;
    return (
      (vd.trackAssignment === 1 || vd.trackAssignment === 2 || vd.trackAssignment === 3) ||
      (vd.pathway === 'license' || vd.pathway === 'company' || vd.pathway === 'both') ||
      !!vd.dualUse ||
      (typeof vd.ecosystemNotes === 'string' && vd.ecosystemNotes.trim().length > 0) ||
      // v3.5
      (typeof vd.institution === 'string' && vd.institution.trim().length > 0) ||
      (vd.verdict === 'yes' || vd.verdict === 'hold' || vd.verdict === 'no') ||
      (typeof vd.technologyDescription === 'string' && vd.technologyDescription.trim().length > 0) ||
      (typeof vd.technologyDomain === 'string' && vd.technologyDomain.trim().length > 0)
    );
  },

  /**
   * Render Venture-Level Advisor Decisions page: Track, Pathway, Dual-use, Local Ecosystem notes.
   */
  addVentureLevelDecisions(doc, data) {
    const pageWidth = doc.internal.pageSize.width;
    const contentWidth = pageWidth - PdfLayout.marginLeft - PdfLayout.marginRight;
    const vd = data.ventureDecisions || {};
    let y = 30;

    PdfTypography.sectionTitle(doc);
    doc.text('Venture-Level Advisor Decisions', PdfLayout.marginLeft, y);
    y += 15;

    const trackLabels = {
      1: 'Track 1 — Research Translation',
      2: 'Track 2 — Startup Formation',
      3: 'Track 3 — Startup Development'
    };
    const pathwayLabels = {
      license: 'License opportunity',
      company: 'Company formation',
      both: 'Both viable'
    };

    const writeLabelValue = (label, value) => {
      PdfTypography.body(doc, 'bold');
      doc.text(label, PdfLayout.marginLeft, y);
      PdfTypography.body(doc);
      y = PdfLayout.drawText(
        doc,
        value,
        PdfLayout.marginLeft + 50,
        y,
        { maxWidth: contentWidth - 50 }
      );
      y += 4;
    };

    // v3.5: Verdict — show first since it's the headline decision
    const verdictLabels = { yes: 'Yes — continue with DD', hold: 'Hold', no: 'No' };
    if (vd.verdict && verdictLabels[vd.verdict]) {
      writeLabelValue('Verdict:', verdictLabels[vd.verdict]);
    }

    // v3.5: Institution
    if (typeof vd.institution === 'string' && vd.institution.trim()) {
      writeLabelValue('Institution:', vd.institution.trim());
    }

    // v3.5: Technology Domain
    if (typeof vd.technologyDomain === 'string' && vd.technologyDomain.trim()) {
      writeLabelValue('Tech Domain:', vd.technologyDomain.trim());
    }

    // Track
    if (vd.trackAssignment === 1 || vd.trackAssignment === 2 || vd.trackAssignment === 3) {
      writeLabelValue('Track:', trackLabels[vd.trackAssignment]);
    }

    // Pathway
    if (vd.pathway && pathwayLabels[vd.pathway]) {
      writeLabelValue('Pathway:', pathwayLabels[vd.pathway]);
    }

    // Dual-use — only shown when true (absence means "no" or undecided)
    if (vd.dualUse) {
      writeLabelValue('Dual-use:', 'Yes');
    }

    // v3.5: Technology Description (free-text block)
    if (typeof vd.technologyDescription === 'string' && vd.technologyDescription.trim()) {
      y += 4;
      PdfTypography.heading(doc);
      doc.text('Technology Description', PdfLayout.marginLeft, y);
      y += 8;
      PdfTypography.body(doc);
      y = PdfLayout.drawText(
        doc,
        vd.technologyDescription,
        PdfLayout.marginLeft,
        y,
        { maxWidth: contentWidth }
      );
    }

    // Local Ecosystem Activation
    if (typeof vd.ecosystemNotes === 'string' && vd.ecosystemNotes.trim().length > 0) {
      y += 4;
      PdfTypography.heading(doc);
      doc.text('Local Ecosystem Activation', PdfLayout.marginLeft, y);
      y += 8;
      PdfTypography.body(doc);
      y = PdfLayout.drawText(
        doc,
        vd.ecosystemNotes,
        PdfLayout.marginLeft,
        y,
        { maxWidth: contentWidth }
      );
    }
  },

  /**
   * Add appendix cover page
   */
  addAppendixCover(doc) {
    const pageWidth = doc.internal.pageSize.width;

    PdfTypography.documentTitle(doc);
    doc.text('Appendix', pageWidth / 2, 80, { align: 'center' });

    PdfTypography.heading(doc, 'normal');
    doc.text(
      'Detailed assessment data and supporting analysis',
      pageWidth / 2,
      100,
      { align: 'center' }
    );

    doc.setDrawColor(200);
    doc.setLineWidth(0.5);
    doc.line(60, 110, pageWidth - 60, 110);
  },

  /**
   * Add company details to appendix
   */
  addCompanyDetails(doc, company) {
	  let y = 30;

	  PdfTypography.subsectionTitle(doc);
	  doc.text('Company Details', 20, y);
	  y += 12;

	  // Narrative Summary
	  PdfTypography.heading(doc);
	  doc.text('Executive Summary', 20, y);
	  y += 8;
	  
	  PdfTypography.body(doc);
	  
	  const overview = company.company_overview || {};
	  const tech = company.technology || {};
	  const market = company.market_context || {};
	  
	  // Create narrative (v3 schema fields)
	  const products = company.products_services || {};
	  const sv = company.solution_value || {};
	  const narrative = `${overview.name || 'The company'} is a ${overview.company_stage || 'technology'} stage company founded in ${overview.founded_year || 'recent years'}. ${overview.one_liner || overview.detailed_description || 'The company focuses on innovative technology solutions.'}

	The company's core technology involves ${tech.core_technology || 'advanced solutions'}. ${tech.technology_readiness ? 'Technology readiness: ' + tech.technology_readiness + '.' : ''}

	Operating in the ${market.target_market || 'technology'} market, the company addresses ${sv.problem_statement || 'market needs'} with a value proposition of ${sv.value_proposition || 'innovative solutions'}.`;

	  const narrativeLines = doc.splitTextToSize(narrative, 160);
	  narrativeLines.forEach(line => {
		if (y > 270) {
		  PdfLayout.addPage(doc);
		  y = 30;
		}
		doc.text(line, 20, y);
		y += 5;
	  });
	  
	  y += 10;
	  
	  // Detailed Table
	  if (y > 200) {
		PdfLayout.addPage(doc);
		y = 30;
	  }
	  
	  PdfTypography.heading(doc);
	  doc.text('Detailed Information', 20, y);
	  y += 8;
	  
	  // Create table format
	  const details = [
		['Company Name', overview.name || '-'],
		['Website', overview.website || '-'],
		['Founded', overview.founded_year || '-'],
		['Stage', overview.company_stage || '-'],
		['Headquarters', overview.headquarters || '-'],
		['Target Market', market.target_market || '-'],
		['Business Model', products.business_model || '-']
	  ];
	  
	  PdfTypography.body(doc);
	  details.forEach(([label, value]) => {
		if (y > 270) {
		  PdfLayout.addPage(doc);
		  y = 30;
		}
		doc.setFont(undefined, 'bold');
		doc.text(label + ':', 20, y);
		doc.setFont(undefined, 'normal');
		const valueLines = doc.splitTextToSize(String(value), 120);
		doc.text(valueLines, 70, y);
		y += valueLines.length * 5 + 2;
	  });
  },

  /**
   * Add team details to appendix
   */
  addTeamDetails(doc, team) {
    const pageWidth = doc.internal.pageSize.width;
    let y = 30;

    PdfTypography.subsectionTitle(doc);
    doc.text('Team Details', 20, y);
    y += 12;

    if (!team) {
      PdfTypography.body(doc);
      doc.text('Team data not available.', 20, y);
      return;
    }

    const formatted = team.formatted || {};
    const composition = formatted.teamComposition || {};
    const members = formatted.members || [];

    const ensureSpace = (padding = 25) => {
      if (y > 280 - padding) {
        PdfLayout.addPage(doc);
        y = 30;
      }
    };

    const renderList = (title, items, formatter, emptyLabel, maxItems = null) => {
      ensureSpace(30);
      PdfTypography.heading(doc);
      doc.text(title, 20, y);
      y += 8;

      PdfTypography.body(doc);
      if (!items || items.length === 0) {
        doc.text(`- ${emptyLabel}`, 25, y);
        y += 6;
        return;
      }

      const entries = maxItems ? items.slice(0, maxItems) : items;
      entries.forEach(item => {
        const text = formatter(item);
        const lines = doc.splitTextToSize(`- ${text}`, pageWidth - 50);
        lines.forEach(line => {
          ensureSpace(10);
          doc.text(line, 25, y);
          y += 5;
        });
      });

      if (maxItems && items.length > maxItems) {
        doc.text(`...and ${items.length - maxItems} more`, 25, y);
        y += 6;
      }

      y += 4;
    };

    PdfTypography.heading(doc);
    doc.text('Summary', 20, y);
    y += 8;

    PdfTypography.body(doc);
    doc.text(`- Total Members: ${composition.total ?? members.length}`, 25, y);
    y += 5;
    doc.text(`- Technical Experts: ${composition.technical ?? 0}`, 25, y);
    y += 5;
    doc.text(`- Business Leaders: ${composition.business ?? 0}`, 25, y);
    y += 5;
    doc.text(`- Domain Experts: ${composition.domain ?? 0}`, 25, y);
    y += 10;

    renderList(
      'Key Strengths',
      formatted.strengths || [],
      item => (typeof item === 'string' ? item : JSON.stringify(item)),
      'No strengths recorded',
      8
    );

    renderList(
      'Key Gaps',
      formatted.gaps || [],
      item => (typeof item === 'string' ? item : JSON.stringify(item)),
      'No gaps recorded',
      8
    );

    renderList(
      'Relevant Experience Highlights',
      formatted.experiences || [],
      item => (typeof item === 'string' ? item : JSON.stringify(item)),
      'No experience highlights recorded',
      10
    );

    const formatWork = (entry) => {
      if (typeof entry === 'string') return entry;
      const parts = [];
      if (entry.position) parts.push(entry.position);
      if (entry.company) parts.push(`@ ${entry.company}`);
      if (entry.duration) parts.push(`(${entry.duration})`);
      return parts.filter(Boolean).join(' ');
    };

    const formatEducation = (entry) => {
      if (typeof entry === 'string') return entry;
      const parts = [];
      if (entry.degree) parts.push(entry.degree);
      if (entry.institution) parts.push(`- ${entry.institution}`);
      if (entry.year) parts.push(`(${entry.year})`);
      return parts.filter(Boolean).join(' ');
    };

    const formatCommercial = (entry) => {
      if (typeof entry === 'string') return entry;
      const parts = [];
      if (entry.description) parts.push(entry.description);
      if (entry.company) parts.push(`(${entry.company})`);
      if (entry.outcome) parts.push(`- ${entry.outcome}`);
      return parts.filter(Boolean).join(' ');
    };

    const formatPublication = (entry) => {
      if (typeof entry === 'string') return entry;
      const parts = [];
      if (entry.title) parts.push(entry.title);
      if (entry.venue) parts.push(`- ${entry.venue}`);
      if (entry.year) parts.push(`(${entry.year})`);
      return parts.filter(Boolean).join(' ');
    };

    const formatAward = (entry) => {
      if (typeof entry === 'string') return entry;
      const parts = [];
      if (entry.award_name) parts.push(entry.award_name);
      if (entry.organization) parts.push(`- ${entry.organization}`);
      if (entry.year) parts.push(`(${entry.year})`);
      return parts.filter(Boolean).join(' ');
    };

    members.forEach(member => {
      ensureSpace(40);
      PdfTypography.heading(doc);
      doc.text(member.name || 'Team Member', 20, y);
      y += 8;

      PdfTypography.body(doc);
      if (member.role_at_venture) {
        doc.text(`Role: ${member.role_at_venture}`, 25, y);
        y += 6;
      }

      renderList(
        'Commercial Experience',
        member.commercialization_experience || [],
        formatCommercial,
        'No commercialization experience listed'
      );

      renderList(
        'Work History',
        member.work_history || [],
        formatWork,
        'No work history listed'
      );

      renderList(
        'Education',
        member.education_history || [],
        formatEducation,
        'No education history listed'
      );

      renderList(
        'Papers & Publications',
        member.papers_publications || [],
        formatPublication,
        'No publications listed'
      );

      renderList(
        'Awards & Recognition',
        member.awards_recognition || [],
        formatAward,
        'No awards listed'
      );

      y += 6;
    });

    const sources = formatted.sources || [];
    if (sources.length > 0) {
      ensureSpace(25);
      PdfTypography.heading(doc);
      doc.text('Sources', 20, y);
      y += 8;

      PdfTypography.body(doc);
      sources.forEach(source => {
        const lines = doc.splitTextToSize(`- ${source}`, pageWidth - 50);
        lines.forEach(line => {
          ensureSpace(10);
          doc.text(line, 25, y);
          y += 5;
        });
      });
    }
  },

  /**
   * Add competitive details to appendix
   */
  addCompetitiveDetails(doc, competitive) {
  let y = 30;

  PdfTypography.subsectionTitle(doc);
  doc.text('Competitive Analysis Details', 20, y);
  y += 12;

  PdfTypography.body(doc);

  // Add summary details first
  const details = [
    `Total Competitors: ${competitive.assessment.competitor_count.total}`,
    `Competitive Intensity: ${competitive.assessment.competitive_intensity}`,
    `Confidence Level: ${competitive.analysis.data_quality?.confidence_level || 'N/A'}`,
    '',
    'Market Leaders:',
    ...competitive.assessment.market_leaders.slice(0, 5).map(leader => `  - ${leader}`),
  ];

  details.forEach(line => {
    if (y > 270) {
      PdfLayout.addPage(doc);
      y = 30;
    }
    doc.text(line, 20, y);
    y += 6;
  });

  // Add ALL competitors
  y += 10;
  if (y > 240) {
    PdfLayout.addPage(doc);
    y = 30;
  }
  
  doc.setFont(undefined, 'bold');
  doc.text('All Identified Competitors:', 20, y);
  y += 8;
  
  doc.setFont(undefined, 'normal');
  const allCompetitors = competitive.analysis.competitors || [];
  
  allCompetitors.forEach((comp, index) => {
    if (y > 250) {
      PdfLayout.addPage(doc);
      y = 30;
    }
    
    // Company name and size
    doc.setFont(undefined, 'bold');
    doc.text(`${index + 1}. ${comp.company_name || 'Unknown'}`, 25, y);
    doc.setFont(undefined, 'normal');
    doc.text(`(${comp.size_category || 'Unknown size'})`, 120, y);
    y += 6;
    
    // In addCompetitiveDetails method, update the competitor description section (around line 520):
	// Product/Description
	if (comp.product_description) {
	  const descLines = doc.splitTextToSize(comp.product_description, 150); // Reduced from 160
	  descLines.slice(0, 3).forEach(line => { // Show up to 3 lines
		if (y > 270) {
		  PdfLayout.addPage(doc);
		  y = 30;
		}
		doc.text(line, 30, y);
		y += 4; // Reduced line spacing
	  });
	}
    y += 3;
  });

  // Add risk factors
  if (y > 220) {
    PdfLayout.addPage(doc);
    y = 30;
  }
  
  y += 10;
  doc.setFont(undefined, 'bold');
  doc.text('Key Risk Factors:', 20, y);
  y += 8;
  doc.setFont(undefined, 'normal');
  
  competitive.assessment.key_risk_factors.forEach(risk => {
    if (y > 270) {
      PdfLayout.addPage(doc);
      y = 30;
    }
    const riskLines = doc.splitTextToSize(`- ${risk}`, 170);
    riskLines.forEach(line => {
      doc.text(line, 25, y);
      y += 5;
    });
    y += 2;
  });
},

  /**
   * Add market details to appendix
   */
    addMarketDetails(doc, market) {
    let y = 30;
  
    PdfTypography.subsectionTitle(doc);
  doc.text('Market Analysis Details', 20, y);
  y += 12;

  // Primary market
  PdfTypography.heading(doc);
  doc.text('Primary Market', 20, y);
  y += 8;
  
  PdfTypography.body(doc);
  doc.text(`Description: ${market.analysis.primary_market.description}`, 25, y);
  y += 6;
  doc.text(`TAM: ${Formatters.currency(market.analysis.primary_market.tam_usd)}`, 25, y);
  y += 6;
  doc.text(`CAGR: ${Formatters.percentage(market.analysis.primary_market.cagr_percent)}`, 25, y);
  y += 10;

  // All market segments
  doc.setFont(undefined, 'bold');
  doc.text('All Market Segments Analyzed:', 20, y);
  y += 8;
  
  doc.setFont(undefined, 'normal');
  market.analysis.markets.forEach((mkt, index) => {
    if (y > 250) {
      PdfLayout.addPage(doc);
      y = 30;
    }

    doc.setFont(undefined, 'bold');
    doc.text(`${index + 1}. ${mkt.description}`, 25, y);
    y += 6;
    
    doc.setFont(undefined, 'normal');
    doc.text(`  TAM: ${Formatters.currency(mkt.tam_current_usd)}`, 30, y);
    y += 5;
    doc.text(`  CAGR: ${Formatters.percentage(mkt.cagr_percent)}`, 30, y);
    y += 5;
    doc.text(`  Confidence: ${Formatters.confidence(mkt.confidence)}`, 30, y);
    y += 8;
  });

  // Market opportunities
  if (y > 220) {
    PdfLayout.addPage(doc);
    y = 30;
  }
  
  y += 10;
  doc.setFont(undefined, 'bold');
  doc.text('Market Opportunities:', 20, y);
  y += 8;
  doc.setFont(undefined, 'normal');
  
  const opportunities = market.analysis.market_analysis?.opportunities || [];
  opportunities.forEach(opp => {
    if (y > 270) {
      PdfLayout.addPage(doc);
      y = 30;
    }
      const oppLines = doc.splitTextToSize(`- ${opp}`, 170);
      oppLines.forEach(line => {
        doc.text(line, 25, y);
        y += 5;
      });
    y += 2;
  });
  },

  /**
   * Add IP risk details to appendix
   */
  addIpRiskDetails(doc, iprisk) {
    const pageWidth = doc.internal.pageSize.width;
    let y = 30;

    const formatted = iprisk.formatted || {};

    const ensureSpace = (padding = 20) => {
      if (y > 280 - padding) {
        PdfLayout.addPage(doc);
        y = 30;
      }
    };

    const renderParagraphSection = (title, text) => {
      ensureSpace(25);
      PdfTypography.heading(doc);
      doc.text(title, 20, y);
      y += 8;

      PdfTypography.body(doc);
      const content = text || 'No information provided.';
      const lines = doc.splitTextToSize(content, pageWidth - 40);
      lines.forEach(line => {
        ensureSpace(10);
        doc.text(line, 20, y);
        y += 5;
      });
      y += 6;
    };

    const renderListSection = (title, items) => {
      ensureSpace(25);
      PdfTypography.heading(doc);
      doc.text(title, 20, y);
      y += 8;

      PdfTypography.body(doc);
      if (!items || items.length === 0) {
        doc.text('- None noted', 25, y);
        y += 6;
        return;
      }

      items.forEach(item => {
        const lines = doc.splitTextToSize(`- ${item}`, pageWidth - 45);
        lines.forEach(line => {
          ensureSpace(10);
          doc.text(line, 25, y);
          y += 5;
        });
        y += 3;
      });
      y += 4;
    };

    const formatPatentEntry = (patent) => {
      if (!patent) return 'Unknown patent';
      if (typeof patent === 'string') return patent;

      const parts = [];
      if (patent.patentID || patent.id) parts.push(patent.patentID || patent.id);
      if (patent.title) parts.push(patent.title);
      if (patent.year) parts.push(`(${patent.year})`);
      if (patent.assignee) parts.push(`- ${patent.assignee}`);
      return parts.filter(Boolean).join(' ');
    };

    PdfTypography.subsectionTitle(doc);
    doc.text('IP Landscape Analysis Details', 20, y);
    y += 12;

    renderParagraphSection(
      'Company IP Summary',
      formatted.companyIP?.summary || formatted.companyIP?.description || formatted.companyCurrentIP?.description
    );

    const ownedPatents = (formatted.companyIP?.ownedPatents || []).map(formatPatentEntry);
    renderListSection('Company-Owned Patents', ownedPatents);

    renderListSection('Unique Protectable Features', formatted.uniqueFeatures || []);
    renderListSection('Crowded Feature Areas', formatted.crowdedFeatures || []);

    const topOwners = (formatted.topOwners || []).map(owner => {
      const count = owner.patentCount ?? 0;
      return `${owner.assignee || 'Unknown Assignee'} - ${count} patent${count === 1 ? '' : 's'}`;
    });
    renderListSection('Top Patent Owners', topOwners);

    const awardedPatents = (formatted.awardedPatents || []).map(formatPatentEntry);
    renderListSection('Granted Patents Reviewed', awardedPatents);

    const pendingPatents = (formatted.pendingPatents || []).map(formatPatentEntry);
    renderListSection('Pending Applications Reviewed', pendingPatents);

    const referencePatents = (formatted.relevantPatents || []).map(formatPatentEntry);
    renderListSection('Reference Patents Informing Risk Assessment', referencePatents);
  }
};

// Make available globally
window.ExportUtility = ExportUtility;












