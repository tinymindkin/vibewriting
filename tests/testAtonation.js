const path = require('path');

// 导入PDF高亮提取函数
const { extractHighlightsFromFiles } = require('../main/pdf.js');

async function testPDFHighlightExtraction() {
  console.log('🧪 开始测试PDF高亮提取...\n');
  
  // PDF文件路径
  const pdfPath = path.join(__dirname, 'files', 'advance and challenges.pdf');
  console.log(`📄 目标PDF文件: ${pdfPath}\n`);
  
  try {
    // 提取高亮内容
    const results = await extractHighlightsFromFiles([pdfPath]);
    
    if (results && results.length > 0) {
      console.log(results);
      const pdfInfo = results[0];
      
      console.log('📋 PDF信息:');
      console.log(`  - 文件名: ${pdfInfo.name}`);
      console.log(`  - 标题: ${pdfInfo.title || '无标题'}`);
      console.log(`  - 高亮注释数量: ${pdfInfo.notes?.length || 0}`);
      console.log(`  - 高亮分组数量: ${pdfInfo.groups?.length || 0}\n`);
      
      if (pdfInfo.error) {
        console.error('❌ 提取过程中出现错误:', pdfInfo.error);
        return;
      }
      
      // 显示分组的高亮内容
      if (pdfInfo.groups && pdfInfo.groups.length > 0) {
        console.log('🎯 提取到的高亮内容分组:\n');
        
        pdfInfo.groups.forEach((group, index) => {
          console.log(`--- 分组 ${index + 1} ---`);
          console.log(`📖 页码: ${group.page}`);
          console.log(`📝 段落数: ${group.count}`);
          
          // 显示批注内容（如果有）
          if (group.contents && group.contents.length > 0) {
            console.log(`💬 批注: ${group.contents.join(' / ')}`);
          }
          
          // 显示高亮文本
          if (group.text && group.text.trim()) {
            console.log(`🔍 高亮文本: "${group.text}"`);
          } else {
            console.log('🔍 高亮文本: (无法恢复文字)');
          }
          
          console.log(''); // 空行分隔
        });
      } else {
        console.log('⚠️ 未发现任何高亮内容');
      }
      
      // 显示详细的注释信息
      if (pdfInfo.notes && pdfInfo.notes.length > 0) {
        console.log('\n📝 详细注释信息:');
        pdfInfo.notes.forEach((note, index) => {
          console.log(`  ${index + 1}. 页面${note.page} - ${note.subtype}`);
          if (note.contents) {
            console.log(`     批注: "${note.contents}"`);
          }
          if (note.text) {
            console.log(`     文本: "${note.text}"`);
          }
          if (note.color) {
            console.log(`     颜色: [${note.color.join(', ')}]`);
          }
        });
      }
      
    } else {
      console.log('❌ 未能提取到任何内容');
    }
    
  } catch (error) {
    console.error('❌ 测试过程中发生错误:');
    console.error(error);
  }
}

// 执行测试
testPDFHighlightExtraction()
  .then(() => {
    console.log('\n✅ 测试完成');
  })
  .catch((error) => {
    console.error('\n❌ 测试执行失败:', error);
  });