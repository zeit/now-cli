/*
	Has browser ignore leading tabs for <p id="markdown"> blocks.
	modified from: http://stackoverflow.com/a/8505182/4525897
*/
var markdown_blocks = document.getElementsByClassName('markdown');
for (var i = 0; i < markdown_blocks.length; i++)
{
	if(markdown_blocks[i].getAttribute('class') == "markdown")
	{
		var content = markdown_blocks[i].innerHTML;

		var tabs_to_remove = '';
		while(content.indexOf('\t') == '0' || content.substring(0, 4) == "    ")
		{
			if(content.indexOf('\t') == '0')
			{
				tabs_to_remove += '\t';
				content = content.substring(1);
			}
			else
			{
				tabs_to_remove += "    ";
				content = content.substring(4);
			}
		}

		var re = new RegExp('\n' + tabs_to_remove, 'g');
		content = content.replace(re, '\n');

		if(content.lastIndexOf("\n")>0) 
			content = content.substring(0, content.lastIndexOf("\n"));
		markdown_blocks[i].outerHTML = '<p class="markdown">' + content + '</p>';
	}
}
